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
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  backupDir, controlPipePath, dataDir, dbFile, envFilePath, errorLogFile, isPortBusy,
  isWindows, logFile, parseArgs, readJson, sleep, stateFile, uploadDir, writeJson,
} from './common.mjs';
import { readEnvFile } from './envfile.mjs';

const args = parseArgs();
const ROOT = path.resolve(args.get('root', process.cwd()));
const JSON_MODE = args.has('json');
const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'status';

const env = readEnvFile(envFilePath(ROOT));
const PORT = Number(env.PORT || 3000);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const PIPE = env.PISHKAN_CONTROL_PIPE || controlPipePath(ROOT);
const DB = env.SQLITE_FILE || dbFile(ROOT);

function out(payload) {
  if (JSON_MODE) process.stdout.write(`RESULT_JSON:${JSON.stringify(payload)}\n`);
  else process.stdout.write(`${payload.message ?? JSON.stringify(payload)}\n`);
  return payload;
}

function state() {
  return readJson(stateFile(ROOT), null);
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
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

async function start() {
  const current = state();
  const owned = Boolean(current?.pid) && current.root === ROOT && pidAlive(current.pid);
  const existing = await health();
  if (existing.up && owned) {
    return out({ ok: true, alreadyRunning: true, port: PORT, url: URL_BASE, pid: current.pid,
      message: `Pishkan این نصب از قبل در حال اجراست: ${URL_BASE}` });
  }
  if (existing.up) {
    // Something answers on the port but this installation does not own it: it is
    // another checkout, another program, or a leftover process. Never claim it.
    return out({ ok: false, port: PORT, url: URL_BASE, foreignOccupied: true,
      message: `پورت ${PORT} به یک سرویس دیگر (نصب دیگر Pishkan یا برنامه‌ای دیگر) تعلق دارد. آن را ببندید یا پورت این نصب را در فایل تنظیمات تغییر دهید.` });
  }
  if (await isPortBusy(PORT)) {
    return out({ ok: false, port: PORT, url: URL_BASE,
      message: `پورت ${PORT} توسط برنامه دیگری اشغال است. پورت را در فایل تنظیمات تغییر دهید یا برنامه اشغال‌کننده را ببندید.` });
  }
  const apiEntry = path.join(ROOT, 'apps', 'api', 'dist', 'index.js');
  if (!fs.existsSync(apiEntry)) {
    return out({ ok: false, message: 'خروجی ساخت API پیدا نشد (apps/api/dist). ابتدا نصب/ساخت را اجرا کنید.' });
  }
  if (!fs.existsSync(envFilePath(ROOT))) {
    return out({ ok: false, message: 'فایل تنظیمات محلی پیدا نشد. ابتدا نصب‌کننده را اجرا کنید.' });
  }

  fs.mkdirSync(path.dirname(logFile(ROOT)), { recursive: true });
  const logStream = fs.openSync(logFile(ROOT), 'a');
  const errorStream = fs.openSync(errorLogFile(ROOT), 'a');
  const child = spawn(process.execPath, ['--experimental-sqlite', apiEntry], {
    cwd: ROOT,
    env: { ...process.env, PISHKAN_ENV_FILE: envFilePath(ROOT), PISHKAN_CONTROL_PIPE: PIPE },
    detached: true,
    stdio: ['ignore', logStream, errorStream],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logStream);
  fs.closeSync(errorStream);

  const startedAt = new Date().toISOString();
  writeJson(stateFile(ROOT), { pid: child.pid, port: PORT, startedAt, root: ROOT, log: logFile(ROOT) });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    const probe = await health(1000);
    if (probe.up) {
      const reachable = await fetch(`${URL_BASE}/`, { signal: AbortSignal.timeout(2000) })
        .then((r) => r.ok).catch(() => false);
      return out({
        ok: true, port: PORT, url: URL_BASE, pid: child.pid, startedAt,
        web: reachable,
        message: `Pishkan راه‌اندازی شد: ${URL_BASE}${reachable ? '' : ' (رابط کاربری پاسخ نداد)'}`,
      });
    }
    if (!pidAlive(child.pid)) break;
  }
  const tailText = readLogTail(20);
  return out({
    ok: false, port: PORT, pid: child.pid,
    message: `سرور در زمان انتظار پاسخ نداد. گزارش خطا:\n${tailText}`,
  });
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
  const owned = Boolean(current?.pid) && current.root === ROOT && pidAlive(current.pid);
  if (probe.up && !owned) {
    return out({ ok: false, foreignOccupied: true,
      message: 'سرویس در حال اجرا به این نصب تعلق ندارد و متوقف نشد. آن را از برنامه خودش ببندید.' });
  }
  const known = owned;
  if (!probe.up && !known) {
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

function readLogTail(lines = 40) {
  try {
    const text = fs.readFileSync(logFile(ROOT), 'utf8');
    return text.trim().split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
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
      ok: disk && probe.up,
      detail: disk ? `${DB} · ${(fs.statSync(DB).size / 1024 / 1024).toFixed(2)} MB` : 'فایل پایگاه داده پیدا نشد',
    },
    {
      id: 'storage',
      title: 'ذخیره‌سازی فایل‌ها',
      ok: fs.existsSync(uploadDir(ROOT)),
      detail: `${uploadDir(ROOT)} · ${countFiles(uploadDir(ROOT))} فایل`,
    },
  ];
  const current2 = state();
  const ownedNow = Boolean(current2?.pid) && current2.root === ROOT && pidAlive(current2.pid);
  const payload = {
    ok: services.every((service) => service.ok) && (probe.up ? ownedNow : true),
    running: probe.up,
    owned: ownedNow,
    foreignOccupied: probe.up && !ownedNow,
    port: PORT,
    url: URL_BASE,
    pid: current?.pid ?? null,
    startedAt: current?.startedAt ?? null,
    uptimeSeconds: current?.startedAt ? Math.round((Date.now() - new Date(current.startedAt).getTime()) / 1000) : 0,
    version: probe.body?.version ?? null,
    controlChannel: control,
    services,
    dataDir: dataDir(ROOT),
    envFile: envFilePath(ROOT),
    logFile: logFile(ROOT),
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
  if (wasRunning) await stop();
  const safety = `${DB}.before-restore-${Date.now()}`;
  if (fs.existsSync(DB)) fs.copyFileSync(DB, safety);
  fs.copyFileSync(file, DB);
  fs.rmSync(`${DB}-wal`, { force: true });
  fs.rmSync(`${DB}-shm`, { force: true });
  if (wasRunning) await start();
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

/* ---------------------------------- main ---------------------------------- */

const commands = { start, stop, restart, status, backup, restore, open: openApp, 'open-data': openData };

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
  out({ ok: false, message: `خطا: ${error?.message ?? error}` });
  process.exit(2);
});
