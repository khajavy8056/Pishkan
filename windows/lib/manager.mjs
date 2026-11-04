#!/usr/bin/env node
/**
 * Pishkan — local service manager engine (used by the GUI manager window).
 *
 *   node windows/lib/manager.mjs start   --root C:\Pishkan [--json]
 *   node windows/lib/manager.mjs stop    --root C:\Pishkan
 *   node windows/lib/manager.mjs restart --root C:\Pishkan
 *   node windows/lib/manager.mjs status  --root C:\Pishkan [--json]
 *   node windows/lib/manager.mjs logs    --root C:\Pishkan [--lines 40]
 *   node windows/lib/manager.mjs backup  --root C:\Pishkan
 *   node windows/lib/manager.mjs restore --root C:\Pishkan --file <backup.sqlite>
 *   node windows/lib/manager.mjs open    --root C:\Pishkan (opens the browser)
 *
 * The server keeps running after this process exits (detached), so the GUI can
 * call `start` and close. Stopping is graceful: the manager connects to the
 * server's local control pipe and sends "shutdown" — the same shutdown path as
 * SIGTERM (close listener, close database, exit 0). If the server does not
 * answer within 15 s, the manager falls back to terminating the PID recorded in
 * `.data/pishkan-manager.json`, and reports that explicitly.
 *
 * Only `start`/`stop`/`restart` touch processes; `status`, `logs`, `backup` are
 * read-only. Backups use SQLite's `VACUUM INTO`, which is consistent while the
 * server keeps running.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  backupDir, controlPipePath, dataDir, dbFile, envFilePath, errorLogFile, isPortBusy,
  isWindows, logFile, MODULE_DIR, parseArgs, readJson, sleep, stateFile, uploadDir, writeJson,
  pidAlive,
} from './common.mjs';
import { readEnvFile } from './envfile.mjs';
import { isSafeWindowsBindConfig, privateLanUrls } from './lan-access.mjs';
import { qrAscii, qrPngBase64 } from './qr.mjs';
import { runLanFirewall } from './lan-firewall.mjs';
import { formatManagerLogLine, sanitizeManagerLogMessage } from './manager-log.mjs';

const args = parseArgs();
const ROOT = path.resolve(args.get('root', process.cwd()));
const JSON_MODE = args.has('json');
const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'status';

const env = readEnvFile(envFilePath(ROOT));
const PORT = Number(env.PORT || 3000);
const LAN_ACCESS = String(env.LAN_ACCESS ?? '').toLowerCase() === 'true';
const BIND_HOST = env.HOST || '127.0.0.1';
const URL_BASE = `http://127.0.0.1:${PORT}`;

function networkConfigError() {
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) return 'پورت برنامه در فایل تنظیمات معتبر نیست.';
  if (!isSafeWindowsBindConfig(BIND_HOST, LAN_ACCESS)) {
    return LAN_ACCESS
      ? 'تنظیم LAN با HOST سازگار نیست؛ برای LAN باید HOST=0.0.0.0 باشد.'
      : 'اتصال عمومی در فایل تنظیمات غیرفعال نیست؛ برای امنیت، HOST را روی 127.0.0.1 بگذارید یا LAN را از نصب‌کننده با فایروال محدود فعال کنید.';
  }
  return '';
}

function lanAddresses() {
  return LAN_ACCESS ? privateLanUrls(PORT) : [];
}

function publicAccessDetails() {
  const urls = lanAddresses();
  return urls.length ? ` · موبایل (Wi‑Fi خصوصی): ${urls.join('، ')}` : ' · LAN فعال است ولی آدرس IPv4 خصوصی پیدا نشد؛ به Wi‑Fi با نمایهٔ Private وصل شوید.';
}
const PIPE = env.PISHKAN_CONTROL_PIPE || controlPipePath(ROOT);
const DB = env.SQLITE_FILE || dbFile(ROOT);
const MANAGER_LOG = path.join(dataDir(ROOT), 'logs', 'pishkan-manager.log');
const FIREWALL_LEASE_FILE = path.join(dataDir(ROOT), 'lan-firewall-lease.json');

function log(message) {
  const line = formatManagerLogLine(message);
  try {
    fs.mkdirSync(path.dirname(MANAGER_LOG), { recursive: true });
    fs.appendFileSync(MANAGER_LOG, line, 'utf8');
  } catch {
    console.error(`[manager] failed to persist diagnostic: ${sanitizeManagerLogMessage(message, 300)}`);
  }
}

function out(payload) {
  if (JSON_MODE) process.stdout.write(`RESULT_JSON:${JSON.stringify(payload)}\n`);
  else process.stdout.write(`${payload.message ?? JSON.stringify(payload)}\n`);
  return payload;
}

function state() {
  return readJson(stateFile(ROOT), null);
}

function firewallLeaseFresh(token) {
  const lease = readJson(FIREWALL_LEASE_FILE, null);
  if (!lease || lease.ok !== true || lease.token !== token || Number(lease.port) !== PORT) return false;
  const checkedAt = Date.parse(lease.checkedAt ?? '');
  return Number.isFinite(checkedAt) && checkedAt <= Date.now() + 2_000 && Date.now() - checkedAt <= 12_000;
}

function lanGuardHealthy(current) {
  return Boolean(current?.lanGuardPid && pidAlive(current.lanGuardPid)
    && current.firewallLeaseToken && firewallLeaseFresh(current.firewallLeaseToken));
}

function launchLanGuard(serverPid, token) {
  const script = path.join(MODULE_DIR, 'lan-guard.mjs');
  const child = spawn(process.execPath, [
    script, '--root', ROOT, '--server-pid', String(serverPid), '--port', String(PORT),
    '--token', token, '--program', process.execPath, '--pipe', PIPE,
    '--lease-file', FIREWALL_LEASE_FILE,
  ], {
    cwd: ROOT,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.once('error', (error) => log(`LAN firewall watchdog failed to launch: ${sanitizeManagerLogMessage(error?.message ?? error, 300)}`));
  child.unref();
  if (!child.pid) throw new Error('LAN firewall watchdog process did not start.');
  return child.pid;
}

/**
 * "Is Pishkan running?" must not be answered by "something answers on the port":
 * any other program (or a stale proxy) could reply 200. The health payload has to
 * look like Pishkan's own health document.
 */
async function health(ms = 2500) {
  try {
    const response = await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(ms) });
    const body = await response.json().catch(() => null);
    const looksLikePishkan = Boolean(body) && (body.status === 'ok' || body.ok === true) && ('version' in body || 'checks' in body || 'uptime' in body);
    return { up: response.ok && looksLikePishkan, body };
  } catch {
    return { up: false, body: null };
  }
}

function pingControlPipe(ms = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect(PIPE);
    let answered = false;
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(ms);
    socket.once('connect', () => socket.write('ping\n'));
    socket.on('data', (chunk) => {
      if (String(chunk).includes('pong')) {
        answered = true;
        finish(true);
      }
    });
    socket.once('timeout', () => finish(answered));
    socket.once('error', () => finish(false));
  });
}

function closeControlPipe(ms = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect(PIPE);
    let answered = false;
    socket.setTimeout(ms);
    socket.once('connect', () => socket.write('shutdown\n'));
    socket.on('data', (chunk) => {
      if (String(chunk).includes('bye')) answered = true;
    });
    socket.once('close', () => resolve(answered));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(answered);
    });
    socket.once('error', () => resolve(false));
  });
}

/* --------------------------------- start ---------------------------------- */

async function discoverListenerPid() {
  try {
    if (isWindows()) {
      const probe = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
      ], { encoding: 'utf8', timeout: 8_000, windowsHide: true });
      const pid = Number(String(probe.stdout ?? '').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    const probe = spawnSync('sh', ['-c', `lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null | head -1`], { encoding: 'utf8', timeout: 5_000 });
    const pid = Number(String(probe.stdout ?? '').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function start({ lanAllowed = true, lanWarning: inheritedWarning = '', recycled = false } = {}) {
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
    return out({ ok: false, port: PORT, url: URL_BASE, message: 'پورت برنامه در فایل تنظیمات معتبر نیست.' });
  }

  // Effective network mode. LAN is an add-on: it must never brick the local
  // service. Whatever the firewall state, the office app always starts —
  // loopback-only with a clear warning beats «Manager می‌گوید متوقف است» forever.
  let effectiveLan = false;
  let lanWarning = inheritedWarning;
  let firewall = null;
  const wantsLan = LAN_ACCESS && BIND_HOST.trim().toLowerCase() === '0.0.0.0';
  if (wantsLan && lanAllowed) {
    firewall = runLanFirewall('ensure', { root: ROOT, port: PORT, program: process.execPath });
    if (firewall.ok) effectiveLan = true;
    else lanWarning = lanWarning || `دسترسی LAN فعال نشد (${firewall.message})؛ سرویس فقط روی همین رایانه اجرا می‌شود.`;
  } else if (LAN_ACCESS || BIND_HOST.trim().toLowerCase() === '0.0.0.0') {
    lanWarning = lanWarning || 'تنظیم HOST/LAN_ACCESS در فایل تنظیمات ناسازگار است؛ سرویس فقط روی همین رایانه اجرا می‌شود.';
  }
  const bindHost = effectiveLan ? '0.0.0.0' : '127.0.0.1';
  const lanUrlsNow = () => (effectiveLan ? privateLanUrls(PORT) : []);
  const lanDetailsNow = () => {
    const urls = lanUrlsNow();
    return urls.length ? ` · موبایل (Wi‑Fi خصوصی): ${urls.join('، ')}` : ' · LAN فعال است ولی آدرس IPv4 خصوصی پیدا نشد؛ به Wi‑Fi با نمایهٔ Private وصل شوید.';
  };
  if (lanWarning) log(lanWarning);
  const withLan = (payload) => ({
    ...payload,
    lanAccess: effectiveLan,
    ...(lanWarning ? { lanWarning } : {}),
    ...(firewall ? { firewall } : {}),
  });

  const current = state();
  const owned = Boolean(current?.pid) && current.root === ROOT && pidAlive(current.pid);
  const existing = await health();
  if (existing.up && owned) {
    const previousHost = current?.bindHost || (current?.lanAccess ? '0.0.0.0' : '127.0.0.1');
    const guardMissing = effectiveLan && LAN_STRICT && !lanGuardHealthy(current);
    if (previousHost !== bindHost || Boolean(current?.lanAccess) !== effectiveLan || guardMissing) {
      const stopped = await stop();
      if (!stopped.ok) return out(withLan({ ok: false, port: PORT, url: URL_BASE, message: 'پیکربندی شبکه تغییر کرده اما سرویس قبلی متوقف نشد؛ تنظیم جدید اعمال نشد.' }));
      if (!effectiveLan && current?.lanAccess) {
        const removed = runLanFirewall('remove', { root: ROOT, port: PORT, program: process.execPath });
        if (!removed.ok) log(`قانون فایروال قدیمی حذف نشد؛ سرویس جدید loopback-only خواهد بود: ${removed.message}`);
      }
      await sleep(600);
      return start({ lanAllowed, lanWarning, recycled });
    }
    return out(withLan({
      ok: true, alreadyRunning: true, port: PORT, url: URL_BASE, pid: current.pid, mobileUrls: lanUrlsNow(),
      message: `Pishkan این نصب از قبل در حال اجراست: ${URL_BASE}${effectiveLan ? lanDetailsNow() : ''}${lanWarning ? ` — ${lanWarning}` : ''}`,
    }));
  }
  if (existing.up) {
    // Something answers on the port. If it also answers on this root's control
    // pipe, it IS this installation's server — its state file was lost (e.g. a
    // clean install quarantined it). Adopt it instead of refusing forever.
    const ours = await pingControlPipe(1_000);
    if (ours && !effectiveLan) {
      const pid = await discoverListenerPid();
      writeJson(stateFile(ROOT), {
        pid, port: PORT, startedAt: current?.startedAt ?? new Date().toISOString(), root: ROOT, log: logFile(ROOT),
        bindHost, lanAccess: false, firewallLeaseToken: null, lanGuardPid: null, adopted: true,
      });
      return out(withLan({
        ok: true, alreadyRunning: true, adopted: true, port: PORT, url: URL_BASE, pid, mobileUrls: [],
        message: `Pishkan این نصب از قبل در حال اجراست: ${URL_BASE}${lanWarning ? ` — ${lanWarning}` : ''}`,
      }));
    }
    if (ours && effectiveLan && !recycled) {
      // Its firewall-lease token belongs to a previous launch; recycle it once.
      await closeControlPipe();
      await sleep(800);
      return start({ lanAllowed, lanWarning, recycled: true });
    }
    return out(withLan({
      ok: false, port: PORT, url: URL_BASE, foreignOccupied: true,
      message: `پورت ${PORT} به یک سرویس دیگر (نصب دیگر Pishkan یا برنامه‌ای دیگر) تعلق دارد. آن را ببندید یا پورت این نصب را در فایل تنظیمات تغییر دهید.`,
    }));
  }
  if (owned) {
    // Our recorded process is alive but not answering (hung boot, wedged):
    // stop it ourselves instead of blaming «another program» for the port.
    log(`Owned server pid=${current.pid} is alive but unhealthy; stopping it before a fresh start.`);
    await stop();
    if (current?.pid && pidAlive(current.pid)) {
      forceKill(current.pid);
      for (let attempt = 0; attempt < 12 && pidAlive(current.pid); attempt += 1) await sleep(250);
    }
    await sleep(400);
  }
  if (await isPortBusy(PORT)) {
    return out(withLan({
      ok: false, port: PORT, url: URL_BASE,
      message: `پورت ${PORT} توسط برنامه دیگری اشغال است. پورت را در فایل تنظیمات تغییر دهید یا برنامه اشغال‌کننده را ببندید (در Task Manager فرایندهای قدیمی node.exe را هم بررسی کنید).`,
    }));
  }
  const apiEntry = path.join(ROOT, 'apps', 'api', 'dist', 'index.js');
  if (!fs.existsSync(apiEntry)) {
    return out(withLan({ ok: false, message: 'خروجی ساخت API پیدا نشد (apps/api/dist). ابتدا نصب/ساخت را اجرا کنید.' }));
  }
  if (!fs.existsSync(envFilePath(ROOT))) {
    return out(withLan({ ok: false, message: 'فایل تنظیمات محلی پیدا نشد. ابتدا نصب‌کننده را اجرا کنید.' }));
  }

  // The live firewall lease only exists in strict mode; simple mode never
  // depends on a watchdog file to keep the office service reachable.
  const firewallLeaseToken = effectiveLan && LAN_STRICT ? crypto.randomBytes(24).toString('hex') : null;
  if (firewallLeaseToken) {
    try {
      writeJson(FIREWALL_LEASE_FILE, {
        ok: true, token: firewallLeaseToken, port: PORT, checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      log(`Initial firewall lease could not be written; falling back to loopback: ${sanitizeManagerLogMessage(error?.message ?? error, 300)}`);
      return start({ lanAllowed: false, lanWarning: 'تأیید زندهٔ فایروال ذخیره نشد؛ سرویس فقط روی همین رایانه اجرا می‌شود.', recycled });
    }
  }

  fs.mkdirSync(path.dirname(logFile(ROOT)), { recursive: true });
  const logStream = fs.openSync(logFile(ROOT), 'a');
  const errorStream = fs.openSync(errorLogFile(ROOT), 'a');
  const child = spawn(process.execPath, ['--experimental-sqlite', apiEntry], {
    cwd: ROOT,
    env: {
      ...process.env,
      PISHKAN_ENV_FILE: envFilePath(ROOT),
      PISHKAN_CONTROL_PIPE: PIPE,
      PORT: String(PORT),
      HOST: bindHost,
      LAN_ACCESS: effectiveLan ? 'true' : 'false',
      PISHKAN_LAN_FIREWALL_VERIFIED: effectiveLan ? 'true' : 'false',
      PISHKAN_LAN_FIREWALL_STATUS_FILE: effectiveLan ? FIREWALL_LEASE_FILE : '',
      PISHKAN_LAN_FIREWALL_TOKEN: firewallLeaseToken ?? '',
      PISHKAN_LAN_FIREWALL_PORT: String(PORT),
    },
    detached: true,
    stdio: ['ignore', logStream, errorStream],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logStream);
  fs.closeSync(errorStream);

  const startedAt = new Date().toISOString();
  const nextState = {
    pid: child.pid, port: PORT, startedAt, root: ROOT, log: logFile(ROOT),
    bindHost, lanAccess: effectiveLan,
    firewallLeaseToken, lanGuardPid: null,
  };
  writeJson(stateFile(ROOT), nextState);
  if (effectiveLan) {
    try {
      nextState.lanGuardPid = launchLanGuard(child.pid, firewallLeaseToken);
      writeJson(stateFile(ROOT), nextState);
    } catch (error) {
      fs.rmSync(FIREWALL_LEASE_FILE, { force: true });
      log(`LAN watchdog did not start; falling back to loopback: ${sanitizeManagerLogMessage(error?.message ?? error, 300)}`);
      await closeControlPipe(1_000);
      for (let attempt = 0; attempt < 12 && pidAlive(child.pid); attempt += 1) await sleep(250);
      if (pidAlive(child.pid)) forceKill(child.pid);
      fs.rmSync(stateFile(ROOT), { force: true });
      return start({ lanAllowed: false, lanWarning: 'ناظر فایروال اجرا نشد؛ سرویس فقط روی همین رایانه اجرا می‌شود.', recycled });
    }
  }

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await sleep(500);
    const probe = await health(1_000);
    if (probe.up) {
      const reachable = await fetch(`${URL_BASE}/`, { signal: AbortSignal.timeout(2_000) })
        .then((r) => r.ok).catch(() => false);
      return out(withLan({
        ok: true, port: PORT, url: URL_BASE, pid: child.pid, startedAt,
        web: reachable, mobileUrls: lanUrlsNow(),
        message: `Pishkan راه‌اندازی شد: ${URL_BASE}${reachable ? '' : ' (رابط کاربری پاسخ نداد)'}${effectiveLan ? lanDetailsNow() : ''}${lanWarning ? ` — ${lanWarning}` : ''}`,
      }));
    }
    if (!pidAlive(child.pid)) break;
  }
  // The server did not become ready. It may still be listening with a failing
  // health check, in which case the reason is in the health payload and in the
  // log — never leave that half-started process behind for the next run.
  const partial = await health(1_500);
  const tailText = readLogTail(20);
  let cleanedUp = false;
  if (pidAlive(child.pid)) {
    await closeControlPipe();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(250);
      if (!pidAlive(child.pid)) break;
    }
    if (pidAlive(child.pid)) forceKill(child.pid);
    cleanedUp = true;
  }
  if (fs.existsSync(stateFile(ROOT))) fs.rmSync(stateFile(ROOT), { force: true });
  const reasons = [];
  if (partial.up) {
    const details = partial.body?.checks ?? partial.body?.services ?? null;
    reasons.push('سرور بالا آمد ولی بررسی آمادگی موفق نبود' + (details ? `: ${JSON.stringify(details).slice(0, 400)}` : ''));
  } else {
    reasons.push('سرور در زمان انتظار پاسخ نداد.');
  }
  return out(withLan({
    ok: false, port: PORT, pid: child.pid, health: partial.body ?? null, cleanedUp,
    message: `${reasons.join(' ')}${cleanedUp ? ' (فرایند نیمه‌کاره متوقف شد)' : ''}\nگزارش:\n${tailText}`,
  }));
}

/* ---------------------------------- stop ---------------------------------- */

function forceKill(pid) {
  if (isWindows()) {
    try {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* ignore */ }
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  }
}

async function stop() {
  const current = state();
  const probe = await health(800);
  let owned = Boolean(current?.pid) && current.root === ROOT && pidAlive(current.pid);
  // A server adopted after its state file was lost has no recorded pid; its
  // control pipe (scoped to this root) is the ownership proof.
  if (probe.up && !owned) owned = await pingControlPipe(800);
  if (probe.up && !owned) {
    return out({ ok: false, foreignOccupied: true,
      message: 'سرویس در حال اجرا به این نصب تعلق ندارد و متوقف نشد. آن را از برنامه خودش ببندید.' });
  }
  const known = owned;
  if (!probe.up && !known) {
    fs.rmSync(FIREWALL_LEASE_FILE, { force: true });
    if (current?.root === ROOT && fs.existsSync(stateFile(ROOT))) fs.rmSync(stateFile(ROOT), { force: true });
    return out({ ok: true, alreadyStopped: true, message: 'Pishkan در حال اجرا نبود.' });
  }
  const graceful = await closeControlPipe();
  let stopped = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(500);
    const now = await health(600);
    if (!now.up) {
      stopped = true;
      break;
    }
  }
  let method = graceful ? 'control-pipe' : 'none';
  if (!stopped && current?.pid) {
    forceKill(current.pid);
    method = 'forced';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(300);
      if (!(await health(500)).up) {
        stopped = true;
        break;
      }
    }
  }
  if (fs.existsSync(stateFile(ROOT))) fs.rmSync(stateFile(ROOT), { force: true });
  if (stopped || !current?.pid || !pidAlive(current.pid)) fs.rmSync(FIREWALL_LEASE_FILE, { force: true });
  return out({
    ok: stopped,
    graceful,
    method,
    message: stopped
      ? `Pishkan متوقف شد (${method === 'control-pipe' ? 'خاموشی نرم' : 'خاتمه اجباری'}).`
      : 'خاموش‌کردن سرویس ناموفق بود؛ فرآیند را در Task Manager ببندید.',
  });
}

async function restart() {
  const first = await stop();
  if (!first.ok) return first;
  await sleep(600);
  return start();
}

/* --------------------------------- status --------------------------------- */

function processDetail(pid) {
  if (!pid || !pidAlive(pid)) return null;
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    return { pid, command: cmdline.join(' ') };
  } catch {
    return { pid, command: null };
  }
}

function readTailLines(file, lines) {
  try {
    // Sanitize legacy log files too; older versions may have written raw errors.
    return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-lines)
      .map((line) => sanitizeManagerLogMessage(line));
  } catch {
    return [];
  }
}

function readLogTail(lines = 40) {
  const outLines = readTailLines(logFile(ROOT), lines);
  // Boot fatals and crashes go to stderr (pishkan-server-error.log). Without
  // them the manager could only say «پاسخ نداد» — the actual reason was hidden.
  const errLines = readTailLines(errorLogFile(ROOT), Math.min(15, lines));
  const parts = [...outLines];
  if (errLines.length) parts.push('— گزارش خطا —', ...errLines);
  return parts.join('\n');
}

function countFiles(dir) {
  let count = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(current, entry.name));
      else count += 1;
    }
  };
  walk(dir);
  return count;
}

async function status() {
  const probe = await health(1500);
  const ready = await fetch(`${URL_BASE}/api/health/ready`, { signal: AbortSignal.timeout(1500) })
    .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
    .catch(() => ({ ok: false, body: null }));
  const web = await fetch(`${URL_BASE}/`, { signal: AbortSignal.timeout(2000) })
    .then(async (r) => ({ ok: r.ok, html: await r.text().catch(() => '') }))
    .catch(() => ({ ok: false, html: '' }));
  const disk = fs.existsSync(DB);
  const current = state();
  const control = probe.up ? await pingControlPipe(800) : false;
  const configError = networkConfigError();
  const candidateMobileUrls = lanAddresses();
  const firewall = LAN_ACCESS && !configError
    ? runLanFirewall('status', { root: ROOT, port: PORT, program: process.execPath })
    : null;
  const guardHealthy = LAN_ACCESS && lanGuardHealthy(current);
  const lanService = LAN_ACCESS ? {
    id: 'lan',
    title: 'دسترسی موبایل در شبکه محلی',
    ok: !configError && Boolean(firewall?.ok) && candidateMobileUrls.length > 0 && (!probe.up || guardHealthy),
    detail: configError || (probe.up && !guardHealthy ? 'ناظر فایروال فعال نیست یا تأیید آن منقضی شده؛ سرویس باید متوقف شود.' : firewall?.message) || 'فایروال LAN بررسی نشد',
  } : null;

  const services = [
    {
      id: 'backend',
      title: 'سرویس Backend (Node.js)',
      ok: probe.up,
      detail: probe.up ? `پاسخ‌گو روی پورت ${PORT}` : 'پاسخ نمی‌دهد',
      pid: current?.pid ?? null,
    },
    {
      id: 'api',
      title: 'API',
      ok: probe.up && ready.ok,
      detail: ready.ok ? `وضعیت: ${ready.body?.status ?? 'ready'}` : 'بررسی آمادگی ناموفق',
    },
    {
      id: 'frontend',
      title: 'رابط کاربری (Frontend)',
      ok: web.ok && web.html.includes('id="root"'),
      detail: web.ok ? (web.html.includes('id="root"') ? 'صفحه اصلی و فایل‌های استاتیک سرو می‌شود' : 'HTML سرو شد ولی ساختار برنامه پیدا نشد') : 'در دسترس نیست',
    },
    {
      id: 'database',
      title: 'پایگاه داده (SQLite)',
      // A stopped server does not make an intact database file a failure.
      ok: disk && (probe.up ? ready.ok : true),
      detail: disk
        ? `${DB} · ${(fs.statSync(DB).size / 1024 / 1024).toFixed(2)} MB${probe.up ? '' : ' · سرور خاموش است'}`
        : 'فایل پایگاه داده پیدا نشد',
    },
    {
      id: 'storage',
      title: 'ذخیره‌سازی فایل‌ها',
      ok: fs.existsSync(uploadDir(ROOT)),
      detail: `${uploadDir(ROOT)} · ${countFiles(uploadDir(ROOT))} فایل`,
    },
    ...(lanService ? [lanService] : []),
  ];
  const current2 = state();
  const ownedNow = (Boolean(current2?.pid) && current2.root === ROOT && pidAlive(current2.pid)) || (probe.up && control);
  const payload = {
    ok: services.every((service) => service.ok) && (probe.up ? ownedNow : true),
    running: probe.up,
    owned: ownedNow,
    foreignOccupied: probe.up && !ownedNow,
    port: PORT,
    url: URL_BASE,
    lanAccess: {
      enabled: LAN_ACCESS,
      host: BIND_HOST,
      ready: LAN_ACCESS ? Boolean(lanService?.ok) : false,
      mobileUrls: LAN_ACCESS && firewall?.ok && (!probe.up || guardHealthy) ? candidateMobileUrls : [],
      candidateUrls: candidateMobileUrls,
      // The QR only ever encodes the private LAN URL (no credentials/tokens), and
      // only while the firewall lease and watchdog are healthy.
      qr: LAN_ACCESS && firewall?.ok && (!probe.up || guardHealthy)
        ? candidateMobileUrls.map((url) => ({ url, pngBase64: qrPngBase64(url) }))
        : [],
      firewall: firewall ?? null,
      watchdog: { running: guardHealthy, pid: current?.lanGuardPid ?? null, leaseFresh: firewallLeaseFresh(current?.firewallLeaseToken) },
      message: LAN_ACCESS ? (configError || firewall?.message || 'فقط loopback فعال است.') : 'دسترسی LAN خاموش است؛ برنامه فقط روی همین رایانه در دسترس است.',
    },
    pid: current?.pid ?? null,
    startedAt: current?.startedAt ?? null,
    uptimeSeconds: current?.startedAt ? Math.round((Date.now() - new Date(current.startedAt).getTime()) / 1000) : 0,
    version: probe.body?.version ?? null,
    controlChannel: control,
    services,
    dataDir: dataDir(ROOT),
    envFile: envFilePath(ROOT),
    logFile: logFile(ROOT),
    errorLogFile: errorLogFile(ROOT),
    lastErrorTail: probe.up ? '' : readTailLines(errorLogFile(ROOT), 8).join('\n'),
    managerLogFile: MANAGER_LOG,
    process: processDetail(current?.pid),
  };
  if (JSON_MODE) {
    process.stdout.write(`RESULT_JSON:${JSON.stringify(payload)}\n`);
  } else {
    const lines = ['وضعیت Pishkan:'];
    for (const service of services) lines.push(`  ${service.ok ? '✓' : '✗'} ${service.title} — ${service.detail}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  return payload;
}

/* --------------------------------- backup --------------------------------- */

async function backup() {
  const target = path.join(backupDir(ROOT), `pishkan-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  if (!fs.existsSync(DB)) return out({ ok: false, message: 'فایل پایگاه داده پیدا نشد؛ پشتیبان‌گیری ممکن نیست.' });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  // Prove the snapshot is readable and complete before reporting success.
  const check = new DatabaseSync(target, { readOnly: true });
  let migrations = 0;
  let users = 0;
  try {
    migrations = Number(check.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c);
    users = Number(check.prepare('SELECT COUNT(*) AS c FROM users').get().c);
  } finally {
    check.close();
  }
  if (migrations <= 0) {
    fs.rmSync(target, { force: true });
    return out({ ok: false, message: 'پشتیبان معتبر نبود و حذف شد.' });
  }
  return out({
    ok: true, file: target, sizeMb: Number((fs.statSync(target).size / 1024 / 1024).toFixed(2)), migrations, users,
    message: `پشتیبان ساخته شد: ${target} (${migrations} مهاجرت، ${users} کاربر)`,
  });
}

async function restore() {
  const file = args.get('file', '');
  if (!file || !fs.existsSync(file)) return out({ ok: false, message: 'فایل پشتیبان پیدا نشد.' });
  const { DatabaseSync } = await import('node:sqlite');
  let migrations = 0;
  try {
    const check = new DatabaseSync(file, { readOnly: true });
    migrations = Number(check.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c);
    check.close();
  } catch (error) {
    return out({ ok: false, message: `فایل انتخابی پشتیبان معتبر Pishkan نیست: ${error?.message ?? error}` });
  }
  if (migrations <= 0) return out({ ok: false, message: 'پشتیبان هیچ مهاجرتی ندارد؛ بازیابی انجام نشد.' });

  const wasRunning = (await health(800)).up;
  const previousPid = state()?.pid ?? null;
  if (wasRunning) {
    const stopped = await stop();
    if (!stopped?.ok) {
      return out({
        ok: false,
        message: 'سرویس در حال اجرا متوقف نشد و بازیابی انجام نشد تا به داده‌ها آسیبی نرسد. راه ساده‌تر: بازیابی را از داخل پنل وب انجام دهید (پنل مدیر ← زیرساخت و پشتیبان‌گیری ← «بازیابی از فایل پشتیبان»). در غیر این صورت سرویس را با دکمه توقف ببندید و دوباره تلاش کنید.',
      });
    }
    // The health endpoint can go quiet a moment before Windows releases the
    // database file handle; wait for the process to actually die so the copy
    // below cannot race a still-closing server (EBUSY/EPERM).
    if (previousPid) {
      for (let attempt = 0; attempt < 20 && pidAlive(previousPid); attempt += 1) await sleep(400);
    }
  }
  const safety = `${DB}.before-restore-${Date.now()}`;
  // Copy with retries: antivirus/indexers on Windows can hold the file for a
  // few seconds right after the server closes it.
  const copyWithRetry = async (from, to) => {
    let lastError = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try { fs.copyFileSync(from, to); return; } catch (error) {
        lastError = error;
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
        await sleep(700);
      }
    }
    throw lastError;
  };
  try {
    if (fs.existsSync(DB)) await copyWithRetry(DB, safety);
    await copyWithRetry(file, DB);
    fs.rmSync(`${DB}-wal`, { force: true });
    fs.rmSync(`${DB}-shm`, { force: true });
  } catch (error) {
    log(`restore copy failed: ${error?.stack ?? error}`);
    if (wasRunning) { try { await start(); } catch { /* best effort */ } }
    return out({
      ok: false, code: error?.code ?? 'copy_failed',
      message: `کپی فایل پایگاه داده ممکن نشد (${error?.code ?? 'خطای فایل'}): فایل احتمالاً توسط برنامه دیگری (آنتی‌ویروس یا یک سرویس پیشخوان بازمانده) قفل است. نسخه فعلی دست‌نخورده ماند. راه مطمئن‌تر: بازیابی از داخل پنل وب (پنل مدیر ← زیرساخت و پشتیبان‌گیری ← «بازیابی از فایل پشتیبان»).`,
    });
  }
  if (wasRunning) {
    const started = await start();
    if (!started?.ok) {
      return out({
        ok: false, file, migrations, previousCopy: safety,
        message: 'پایگاه داده جایگزین شد اما سرویس دوباره بالا نیامد؛ گزارش را بررسی کنید. نسخه قبلی برای برگشت نگه داشته شده است: ' + safety,
      });
    }
  }
  return out({
    ok: true, file, migrations, previousCopy: safety, restarted: wasRunning,
    message: `پایگاه داده بازیابی شد (${migrations} مهاجرت). نسخه قبلی: ${safety}`,
  });
}

function openApp() {
  const url = URL_BASE;
  if (isWindows()) spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { stdio: 'ignore' }).unref();
  return out({ ok: true, url, message: `مرورگر باز شد: ${url}` });
}

function openData() {
  const dir = dataDir(ROOT);
  if (isWindows()) spawn('explorer.exe', [dir], { stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [dir], { stdio: 'ignore' }).unref();
  else spawn('xdg-open', [dir], { stdio: 'ignore' }).unref();
  return out({ ok: true, path: dir, message: `پوشه داده باز شد: ${dir}` });
}

function removeLanFirewall() {
  const result = runLanFirewall('remove', { root: ROOT, port: PORT, program: process.execPath });
  log(`Firewall cleanup ${result.ok ? 'completed' : 'failed'}: ${result.message}`);
  return out(result);
}

/**
 * One-click «باز کردن فایروال برای موبایل»: creates this install's narrow LAN
 * firewall rule, elevating through a single Windows UAC prompt when needed,
 * then confirms the phone-reachable addresses (with scannable QR payloads) so
 * the GUI can show them right after the operator clicks Yes.
 */
function fixLanFirewall() {
  const result = ensureLanFirewallElevated({ root: ROOT, port: PORT, program: process.execPath });
  log(`Firewall fix ${result.ok ? 'completed' : 'failed'}: ${result.message}`);
  if (!result.ok) return out(result);
  const urls = privateLanUrls(PORT);
  const qr = urls.map((url) => ({ url, pngBase64: qrPngBase64(url), ascii: qrAscii(url) }));
  return out({
    ...result,
    urls,
    qr,
    message: urls.length
      ? `فایروال برای اتصال گوشی باز شد. حالا در اپ پیشخوان یکی از این آدرس‌ها را وارد کنید یا QR را اسکن کنید: ${urls.join('، ')}`
      : 'قانون فایروال ساخته شد، اما آدرس IPv4 خصوصی روی این رایانه پیدا نشد؛ به Wi‑Fi با نمایهٔ Private وصل شوید و دوباره تلاش کنید.',
  });
}

/* ---------------------------------- main ---------------------------------- */

function lanInfo() {
  const urls = lanAddresses();
  const enabled = LAN_ACCESS && urls.length > 0;
  const qr = urls.map((url) => ({ url, pngBase64: qrPngBase64(url), ascii: qrAscii(url) }));
  const message = enabled
    ? `آدرس دسترسی موبایل (فقط Wi‑Fi خصوصی): ${urls.join('، ')}`
    : LAN_ACCESS
      ? 'LAN فعال است ولی آدرس IPv4 خصوصی پیدا نشد؛ به Wi‑Fi با نمایهٔ Private وصل شوید.'
      : 'دسترسی LAN خاموش است؛ برنامه فقط روی همین رایانه در دسترس است.';
  if (!JSON_MODE && enabled) {
    for (const item of qr) {
      process.stdout.write(`${item.url}\n${item.ascii.join('\n')}\n\n`);
    }
  }
  return out({ ok: true, enabled, urls, qr, host: BIND_HOST, port: PORT, message });
}

const commands = { start, stop, restart, status, backup, restore, open: openApp, 'open-data': openData, 'firewall-remove': removeLanFirewall, lan: lanInfo };

async function main() {
  if (command === 'logs') {
    const lines = Number(args.get('lines', '40'));
    const text = readLogTail(lines);
    return out({ ok: true, lines: text.split('\n'), file: logFile(ROOT), message: text || '(گزارش خالی است)' });
  }
  const handler = commands[command];
  if (!handler) {
    return out({ ok: false, message: `دستور ناشناخته: ${command}` });
  }
  const payload = await handler();
  process.exit(payload?.ok === false ? 1 : 0);
}

main().catch((error) => {
  const diagnostic = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  log(`Unhandled manager failure; command=${command}; ${diagnostic}`);
  out({ ok: false, message: 'اجرای عملیات مدیر محلی ناموفق بود. جزئیات فنیِ پاک‌سازی‌شده در گزارش مدیر ثبت شد.' });
  process.exit(2);
});
