/**
 * Shared helpers for the Windows installer / manager (and their Linux test harness).
 *
 * Everything in windows/lib/*.mjs is plain Node with no Windows-only imports so
 * that the same code can be executed on Linux during development: the CI run
 * (`npm run test:windows-lib`) exercises the real logic here, and only the thin
 * PowerShell GUI layer stays Windows-specific.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Repository root when the scripts live in <root>/windows/lib. */
export const DEFAULT_ROOT = path.resolve(MODULE_DIR, '..', '..');

export const MIN_NODE_VERSION = '22.22.2';
export const DEFAULT_PORT = 3000;
export const ENV_FILE_NAME = '.env.windows.local';

export function isWindows() {
  return process.platform === 'win32';
}

/** Read a small JSON file, returning `fallback` on any problem. */
export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic JSON write (temp file + rename) so a crash never leaves half a file. */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function dataDir(root) {
  return path.join(root, '.data');
}

export function envFilePath(root) {
  return path.join(root, ENV_FILE_NAME);
}

export function dbFile(root) {
  return path.join(dataDir(root), 'pishkan-windows.sqlite');
}

export function uploadDir(root) {
  return path.join(dataDir(root), 'uploads');
}

export function backupDir(root) {
  return path.join(dataDir(root), 'backups');
}

export function logFile(root) {
  return path.join(dataDir(root), 'logs', 'pishkan-server.log');
}

export function errorLogFile(root) {
  return path.join(dataDir(root), 'logs', 'pishkan-server-error.log');
}

export function stateFile(root) {
  return path.join(dataDir(root), 'pishkan-manager.json');
}

export function controlPipePath(root) {
  return isWindows()
    ? `\\\\.\\pipe\\pishkan-${path.basename(root).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'local'}`
    : path.join(dataDir(root), 'pishkan-control.sock');
}

export function installReportPath(root) {
  return path.join(dataDir(root), 'install-report.json');
}

export function errorReportPath(root) {
  return path.join(dataDir(root), 'install-error.json');
}

/** Compare dotted versions without pulling a dependency. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const left = pa[i] ?? 0;
    const right = pb[i] ?? 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      values[name] = next;
      i += 1;
    } else {
      flags.add(name);
    }
  }
  return { flags, values, has: (name) => flags.has(name), get: (name, fallback = '') => values[name] ?? fallback };
}

/** Format bytes for human display (Persian UI keeps Latin digits for sizes). */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Free space on the volume that holds `target` (KB), or null when unknown. */
export function freeSpaceKb(target) {
  try {
    const stats = fs.statfsSync(fs.existsSync(target) ? target : path.dirname(target));
    return Math.floor((stats.bavail * stats.bsize) / 1024);
  } catch {
    return null;
  }
}

export function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) stack.push(full);
        else total += fs.statSync(full).size;
      } catch { /* vanished during walk */ }
    }
  }
  return total;
}

export function countEntries(dir) {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/** Windows build number from os.release() (e.g. 10.0.22631 → 22631). */
export function windowsBuild() {
  const parts = os.release().split('.');
  return Number.parseInt(parts[2] ?? '0', 10) || 0;
}

/** True when the process exists (EPERM means it exists but is someone else's). */
export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when something already listens on the port. */
export async function isPortBusy(port, host = '127.0.0.1') {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export async function findFreePort(start = DEFAULT_PORT, host = '127.0.0.1') {
  for (let port = start; port < start + 50; port += 1) {
    if (!(await isPortBusy(port, host))) return port;
  }
  return 0;
}
