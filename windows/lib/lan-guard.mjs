#!/usr/bin/env node
/**
 * Independent Windows Firewall watchdog for an opted-in LAN listener.
 * The API trusts only the short-lived lease refreshed here; if this process dies,
 * or a firewall check fails, the API closes its listener without Windows-specific
 * firewall code in the cross-platform server.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  dataDir, isWindows, parseArgs, pidAlive, readJson, sleep, stateFile, writeJson,
} from './common.mjs';
import { runLanFirewall } from './lan-firewall.mjs';
import { formatManagerLogLine, sanitizeManagerLogMessage } from './manager-log.mjs';

const args = parseArgs();
const ROOT = path.resolve(args.get('root', ''));
const SERVER_PID = Number(args.get('server-pid'));
const PORT = Number(args.get('port'));
const TOKEN = args.get('token');
const PROGRAM = path.resolve(args.get('program', ''));
const PIPE = args.get('pipe');
const LEASE_FILE = path.resolve(args.get('lease-file', ''));
const EXPECTED_LEASE_FILE = path.join(dataDir(ROOT), 'lan-firewall-lease.json');
const INTERVAL_MS = 2_500;
const FIREWALL_TIMEOUT_MS = 10_000;
const LOG_FILE = path.join(dataDir(ROOT), 'logs', 'pishkan-manager.log');

function samePath(left, right) {
  const a = path.resolve(left).replace(/\\/g, '/');
  const b = path.resolve(right).replace(/\\/g, '/');
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function validArguments() {
  return isWindows()
    && ROOT.length > 0
    && Number.isInteger(SERVER_PID) && SERVER_PID > 0
    && Number.isInteger(PORT) && PORT >= 1024 && PORT <= 65535
    && /^[a-f0-9]{48,64}$/i.test(TOKEN)
    && path.isAbsolute(PROGRAM)
    && PIPE.length > 0
    && path.isAbsolute(LEASE_FILE)
    && samePath(LEASE_FILE, EXPECTED_LEASE_FILE);
}

function log(message) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, formatManagerLogLine(message), 'utf8');
  } catch {
    // The API's lease will expire even if diagnostics cannot be written.
  }
}

function stateMatches() {
  const state = readJson(stateFile(ROOT), null);
  return Boolean(state)
    && Number(state.pid) === SERVER_PID
    && samePath(String(state.root ?? ''), ROOT)
    && state.firewallLeaseToken === TOKEN;
}

function writeLease(ok, extra = {}) {
  writeJson(LEASE_FILE, {
    ok,
    token: TOKEN,
    port: PORT,
    checkedAt: new Date().toISOString(),
    ...extra,
  });
}

function removeOwnLease() {
  const lease = readJson(LEASE_FILE, null);
  if (lease?.token === TOKEN) {
    try { fs.rmSync(LEASE_FILE, { force: true }); } catch { /* stale lease expires in the API */ }
  }
}

function pingControlPipe(timeoutMs = 1_200) {
  return new Promise((resolve) => {
    const socket = net.connect(PIPE);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => socket.write('ping\n'));
    socket.on('data', (chunk) => {
      if (String(chunk).includes('pong')) finish(true);
    });
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

function requestShutdown() {
  return new Promise((resolve) => {
    const socket = net.connect(PIPE);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_500);
    socket.once('connect', () => socket.write('shutdown\n'));
    socket.on('data', (chunk) => {
      if (String(chunk).includes('bye')) finish(true);
    });
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

function forceStopOwnedServer() {
  if (!stateMatches() || !pidAlive(SERVER_PID)) return;
  const result = spawnSync('taskkill', ['/PID', String(SERVER_PID), '/T', '/F'], {
    encoding: 'utf8', timeout: 5_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    log(`Firewall watchdog could not force-stop owned API PID ${SERVER_PID}: ${sanitizeManagerLogMessage(result.stderr || result.error?.message || 'taskkill failed', 300)}`);
  }
}

async function stopOwnedServer() {
  if (!stateMatches() || !pidAlive(SERVER_PID)) return;
  await requestShutdown();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!pidAlive(SERVER_PID)) return;
    await sleep(250);
  }
  forceStopOwnedServer();
}

async function run() {
  if (!validArguments()) process.exit(2);

  while (true) {
    if (!stateMatches() || !pidAlive(SERVER_PID)) {
      removeOwnLease();
      return;
    }

    // Confirm the process still owns this install's control endpoint before
    // refreshing a lease. During startup it may not be ready yet, so a missing
    // ping is not itself treated as a firewall failure.
    await pingControlPipe().catch(() => false);
    if (!stateMatches() || !pidAlive(SERVER_PID)) {
      removeOwnLease();
      return;
    }

    const status = runLanFirewall('status', {
      root: ROOT, port: PORT, program: PROGRAM, timeoutMs: FIREWALL_TIMEOUT_MS,
    });
    if (!status.ok) {
      try { writeLease(false, { message: sanitizeManagerLogMessage(status.message, 300) }); } catch { /* API also fails closed on a stale lease */ }
      log(`LAN listener stopped because its Windows Firewall verification failed: ${sanitizeManagerLogMessage(status.message, 500)}`);
      await stopOwnedServer();
      removeOwnLease();
      return;
    }

    try {
      writeLease(true);
    } catch (error) {
      log(`LAN listener stopped because the firewall lease could not be refreshed: ${sanitizeManagerLogMessage(error?.message ?? error, 500)}`);
      await stopOwnedServer();
      removeOwnLease();
      return;
    }
    await sleep(INTERVAL_MS);
  }
}

run().catch(async (error) => {
  const message = sanitizeManagerLogMessage(error?.stack ?? error, 600);
  log(`LAN firewall watchdog failed closed: ${message}`);
  try { writeLease(false, { message }); } catch { /* the API will close on expiry */ }
  await stopOwnedServer().catch(() => undefined);
  removeOwnLease();
  process.exitCode = 1;
});
