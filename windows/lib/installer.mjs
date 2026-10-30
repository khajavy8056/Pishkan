#!/usr/bin/env node
/**
 * Pishkan — local Windows installer engine.
 *
 * The PowerShell GUI (windows/lib/installer-gui.ps1) only draws the window; all
 * of the real work happens here, in plain Node, so that it can be run and tested
 * on Linux exactly like it runs on Windows:
 *
 *   node windows/lib/installer.mjs --root C:\Pishkan --port 3000 --json-lines
 *
 * Job input (optional): one JSON line on stdin, used by the GUI so that the admin
 * password never appears in the process list, in a temp file or in the shell
 * history:
 *
 *   {"admin":{"fullName":"…","username":"admin","password":"…","mobile":"…"}}
 *
 * Output: one JSON object per line on stdout (type = log|step|retry|result) plus
 * the same information as readable Persian text when `--json-lines` is absent.
 *
 * Guarantees:
 *  - a step is reported `ok` only when its own verification passed,
 *  - a failure is written to `.data/install-error.json` and the process exits 1,
 *  - an existing database/uploads folder is never deleted or overwritten,
 *  - re-running on an installed folder is safe (idempotent).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  MODULE_DIR, DEFAULT_PORT, DEFAULT_ROOT, backupDir, controlPipePath, dataDir, dbFile, dirSizeBytes,
  envFilePath, errorLogFile, errorReportPath, formatBytes, installReportPath, logFile,
  isPortBusy, findFreePort, parseArgs, readJson, sleep, uploadDir, writeJson,
} from './common.mjs';
import { readEnvFile, upsertEnvFile } from './envfile.mjs';

const args = parseArgs();
const ROOT = path.resolve(args.get('root', DEFAULT_ROOT));
const JSON_LINES = args.has('json-lines');
const DRY_RUN = args.has('dry-run');
const SKIP_DEPS = args.has('skip-deps');
const SKIP_BUILD = args.has('skip-build');
const NO_START = args.has('no-start');
const RUN_WORKFLOW = args.has('verify-workflow');
const SKIP_NETWORK = args.has('skip-network') || DRY_RUN;

const startedAt = new Date();
const events = { steps: [], logs: [] };

function emit(event) {
  if (JSON_LINES) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }
  if (event.type === 'step') {
    const mark = event.status === 'ok' ? '✓' : event.status === 'fail' ? '✗' : event.status === 'skip' ? '–' : '…';
    process.stdout.write(`[${mark}] ${event.title}${event.message ? ` — ${event.message}` : ''}\n`);
  } else if (event.type === 'result') {
    process.stdout.write(event.ok ? '\nنصب با موفقیت پایان یافت.\n' : '\nنصب ناموفق بود.\n');
  } else if (event.type === 'log') {
    process.stdout.write(`    ${event.message}\n`);
  }
}

function log(message, level = 'info') {
  const entry = { type: 'log', level, message, at: new Date().toISOString() };
  events.logs.push(entry);
  emit(entry);
}

/** Overall progress weights (sum = 100). */
const WEIGHTS = { env: 4, deps: 42, build: 18, database: 14, admin: 6, start: 6, verify: 10 };
let completedWeight = 0;

function stepEvent(id, title, status, options = {}) {
  const event = {
    type: 'step',
    id,
    title,
    status,
    message: options.message ?? '',
    detail: options.detail ?? '',
    progress: options.progress ?? completedWeight,
    stepProgress: options.stepProgress ?? 0,
    at: new Date().toISOString(),
  };
  if (status === 'ok' || status === 'skip' || status === 'fail') {
    if (!events.steps.some((s) => s.id === id && ['ok', 'fail', 'skip'].includes(s.status))) {
      completedWeight += WEIGHTS[id] ?? 0;
      event.progress = Math.min(completedWeight, 100);
    }
  }
  if (options.append !== false) events.steps.push(event);
  emit(event);
  return event;
}

function runProcess(command, commandArgs, options = {}) {
  const { cwd = ROOT, input, onLine, timeoutMs = 30 * 60 * 1000, env = {} } = options;
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const handle = (chunk, isError) => {
      const text = chunk.toString();
      if (isError) stderr += text; else stdout += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() && onLine) onLine(line, isError);
      }
    };
    child.stdout?.on('data', (chunk) => handle(chunk, false));
    child.stderr?.on('data', (chunk) => handle(chunk, true));
    if (input !== undefined) {
      child.stdin?.end(input);
    } else {
      child.stdin?.end();
    }
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

function tail(text, lines = 25) {
  return text.trim().split(/\r?\n/).slice(-lines).join('\n');
}

async function readJobFromStdin() {
  if (!args.has('job-stdin')) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text.split(/\r?\n/)[0]);
  } catch {
    throw new Error('ورودی تنظیمات نصب‌کننده معتبر نیست (JSON)');
  }
}

function randomHex(bytes) {
  const buffer = Buffer.alloc(bytes);
  crypto.getRandomValues(buffer);
  return buffer.toString('hex');
}

/* ------------------------------- the steps -------------------------------- */

async function stepEnv(job) {
  stepEvent('env', 'آماده‌سازی تنظیمات محلی', 'running', { stepProgress: 5 });
  const file = envFilePath(ROOT);
  const existing = readEnvFile(file);
  const requestedPort = Number(job.port || args.get('port', String(existing.PORT || DEFAULT_PORT)));
  const reinstall = fs.existsSync(file) && Object.keys(existing).length > 0;
  const database = existing.SQLITE_FILE || dbFile(ROOT);

  let port = requestedPort;
  if (await isPortBusy(port)) {
    const free = await findFreePort(port + 1);
    if (!free) throw new Error(`پورت ${port} در حال استفاده است و پورت آزاد دیگری پیدا نشد.`);
    log(`پورت ${port} در حال استفاده بود؛ از پورت آزاد ${free} استفاده می‌شود.`, 'warn');
    port = free;
  }

  const values = {
    NODE_ENV: 'development',
    DB_DRIVER: 'sqlite',
    SQLITE_FILE: database.replace(/\\/g, '/'),
    HOST: '127.0.0.1',
    PORT: String(port),
    APP_URL: `http://127.0.0.1:${port}`,
    API_URL: `http://127.0.0.1:${port}`,
    CORS_ORIGINS: `http://127.0.0.1:${port}`,
    COOKIE_SECURE: 'false',
    APP_ENCRYPTION_KEY: existing.APP_ENCRYPTION_KEY || randomHex(32),
    UPLOAD_DIR: (existing.UPLOAD_DIR || uploadDir(ROOT)).replace(/\\/g, '/'),
    BACKUP_DIR: (existing.BACKUP_DIR || backupDir(ROOT)).replace(/\\/g, '/'),
    PISHKAN_CONTROL_PIPE: existing.PISHKAN_CONTROL_PIPE || controlPipePath(ROOT),
    DEMO_MODE: existing.DEMO_MODE || 'false',
    LOG_LEVEL: existing.LOG_LEVEL || 'info',
  };

  // A dry run still writes the configuration file: it is the cheapest way to
  // prove the generated file is valid, and it creates no database or build.
  {
    upsertEnvFile(file, values, {
      header: [
        '# Pishkan — تنظیمات محلی Windows (تولیدشده با نصب‌کننده گرافیکی)',
        '# این فایل رازدار است: هرگز آن را در Git یا فضای اشتراکی قرار ندهید.',
        '# بازنویسی دستی مجاز است؛ نصب‌کننده مقادیر موجود را حفظ می‌کند.',
        '',
      ],
    });
  }
  for (const dir of ['uploads/incoming', 'uploads/private/originals', 'uploads/private/optimized', 'uploads/private/previews',
    'uploads/public', 'backups', 'logs']) {
    fs.mkdirSync(path.join(dataDir(ROOT), dir), { recursive: true });
  }
  stepEvent('env', 'آماده‌سازی تنظیمات محلی', 'ok', {
    message: `${reinstall ? 'تنظیمات موجود حفظ شد' : 'فایل تنظیمات ساخته شد'} · پورت ${port}`,
    detail: file,
    stepProgress: 100,
  });
  return { port, file, values, reinstall, database };
}

function countInstalledPackages(nodeModules) {
  let count = 0;
  const read = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.bin' || entry.name === '.cache') continue;
      if (entry.name.startsWith('@')) {
        read(path.join(dir, entry.name), depth);
        continue;
      }
      if (fs.existsSync(path.join(dir, entry.name, 'package.json'))) count += 1;
      if (depth < 1 && fs.existsSync(path.join(dir, entry.name, 'node_modules'))) {
        read(path.join(dir, entry.name, 'node_modules'), depth + 1);
      }
    }
  };
  read(nodeModules, 0);
  return count;
}

function expectedPackageCount() {
  const lock = readJson(path.join(ROOT, 'package-lock.json'), null);
  if (!lock?.packages) return 0;
  // Only top-level packages: nested copies live under node_modules/<pkg>/node_modules/…
  return Object.keys(lock.packages).filter((key) => {
    if (!key.startsWith('node_modules/')) return false;
    const parts = key.split('/').slice(1);
    return parts.length === 1 || (parts.length === 2 && parts[0].startsWith('@'));
  }).length;
}

async function stepDependencies() {
  const nodeModules = path.join(ROOT, 'node_modules');
  const expected = expectedPackageCount();
  if (SKIP_DEPS) {
    stepEvent('deps', 'دانلود وابستگی‌ها', 'skip', { message: 'با درخواست کاربر رد شد' });
    return;
  }
  const installed = countInstalledPackages(nodeModules);
  // Optional platform-specific packages are absent from node_modules by design,
  // so a small shortfall against the lockfile is expected and not a re-install.
  if (installed > 0 && (expected === 0 || installed >= expected * 0.85)) {
    stepEvent('deps', 'دانلود وابستگی‌ها', 'ok', {
      message: `${installed} بسته از قبل نصب بود · ${formatBytes(dirSizeBytes(nodeModules))}`,
    });
    return;
  }
  if (DRY_RUN) {
    stepEvent('deps', 'دانلود وابستگی‌ها', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return;
  }

  const hasLock = fs.existsSync(path.join(ROOT, 'package-lock.json'));
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = hasLock ? ['ci', '--no-audit', '--no-fund', '--loglevel=error'] : ['install', '--no-audit', '--no-fund', '--loglevel=error'];
  const attempts = 3;
  stepEvent('deps', 'دانلود وابستگی‌ها', 'running', {
    message: `${hasLock ? 'npm ci' : 'npm install'} · ${expected || '?'} بسته`,
    stepProgress: 1,
  });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timer = setInterval(() => {
      const done = countInstalledPackages(nodeModules);
      const ratio = expected ? Math.min(done / expected, 0.98) : 0.5;
      stepEvent('deps', 'دانلود وابستگی‌ها', 'running', {
        append: false,
        message: `${done}${expected ? ` از ${expected}` : ''} بسته · ${formatBytes(dirSizeBytes(nodeModules))}`,
        stepProgress: Math.round(ratio * 100),
        progress: Math.round(completedWeight + (WEIGHTS.deps ?? 0) * ratio),
      });
    }, 900);

    const result = await runProcess(npmCommand, npmArgs, {
      timeoutMs: 45 * 60 * 1000,
      onLine: (line) => {
        if (/ERR!|error|warn EBADENGINE/i.test(line)) log(line.slice(0, 300), 'warn');
      },
    });
    clearInterval(timer);
    const extracted = countInstalledPackages(nodeModules);

    if (result.code === 0) {
      stepEvent('deps', 'دانلود وابستگی‌ها', 'ok', {
        message: `${extracted} بسته · ${formatBytes(dirSizeBytes(nodeModules))}`,
        stepProgress: 100,
      });
      return;
    }
    const hint = result.timedOut
      ? 'زمان دانلود به پایان رسید'
      : /ETIMEDOUT|ENOTFOUND|ECONNRESET|network|EAI_AGAIN/i.test(result.stderr + result.stdout)
        ? 'اتصال شبکه قطع شد'
        : 'npm با خطا تمام شد';
    if (attempt < attempts) {
      const waitMs = attempt * 4000;
      log(`${hint}. تلاش ${attempt} از ${attempts} ناموفق بود؛ ${waitMs / 1000} ثانیه بعد دوباره تلاش می‌شود.`, 'warn');
      emit({ type: 'retry', id: 'deps', attempt, attempts, waitMs, message: hint });
      stepEvent('deps', 'دانلود وابستگی‌ها', 'running', {
        append: false, message: `تلاش دوباره ${attempt + 1} از ${attempts}`, stepProgress: 5,
      });
      await sleep(waitMs);
      continue;
    }
    throw Object.assign(new Error(`${hint}: ${tail(result.stderr || result.stdout, 12) || `کد خروج ${result.code}`}`), {
      step: 'deps',
      command: `${npmCommand} ${npmArgs.join(' ')}`,
      exitCode: result.code,
      output: tail(result.stderr || result.stdout, 40),
    });
  }
}

async function stepBuild() {
  if (SKIP_BUILD) {
    stepEvent('build', 'ساخت نسخه اجرایی', 'skip', { message: 'با درخواست کاربر رد شد' });
    return;
  }
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (DRY_RUN) {
    stepEvent('build', 'ساخت نسخه اجرایی', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return;
  }
  stepEvent('build', 'ساخت نسخه اجرایی', 'running', { message: 'API در حال ساخت است', stepProgress: 10 });
  for (const [index, workspace] of ['apps/api', 'apps/web'].entries()) {
    const result = await runProcess(npmCommand, ['run', 'build', '--workspace', workspace], {
      timeoutMs: 30 * 60 * 1000,
      onLine: (line) => {
        if (/error/i.test(line)) log(line.slice(0, 300), 'warn');
      },
    });
    if (result.code !== 0) {
      throw Object.assign(new Error(`ساخت ${workspace} ناموفق بود: ${tail(result.stderr || result.stdout, 12)}`), {
        step: 'build', command: `npm run build --workspace ${workspace}`, exitCode: result.code,
        output: tail(result.stderr || result.stdout, 40),
      });
    }
    stepEvent('build', 'ساخت نسخه اجرایی', 'running', {
      append: false,
      message: `${workspace} ساخته شد`,
      stepProgress: (index + 1) * 50,
    });
  }
  const apiIndex = path.join(ROOT, 'apps/api/dist/index.js');
  const webIndex = path.join(ROOT, 'apps/web/dist/index.html');
  if (!fs.existsSync(apiIndex) || !fs.existsSync(webIndex)) {
    throw Object.assign(new Error('خروجی ساخت پیدا نشد (apps/api/dist یا apps/web/dist)'), { step: 'build' });
  }
  stepEvent('build', 'ساخت نسخه اجرایی', 'ok', {
    message: `API و رابط کاربری ساخته شد · ${formatBytes(dirSizeBytes(path.join(ROOT, 'apps/web/dist')))}`,
    stepProgress: 100,
  });
}

async function stepDatabase(config) {
  stepEvent('database', 'ایجاد و مهاجرت پایگاه داده', 'running', { stepProgress: 10 });
  const database = config.database;
  const existed = fs.existsSync(database);
  const sqliteFlag = ['--experimental-sqlite'];
  if (DRY_RUN) {
    stepEvent('database', 'ایجاد و مهاجرت پایگاه داده', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return;
  }
  const result = await runProcess(process.execPath, [...sqliteFlag, 'dist/cli/seed.js', '--catalog-only'], {
    cwd: path.join(ROOT, 'apps/api'),
    env: { PISHKAN_ENV_FILE: config.file },
    timeoutMs: 10 * 60 * 1000,
  });
  if (result.code !== 0) {
    const output = tail(result.stderr || result.stdout, 20);
    const reason = /SQLITE_CANTOPEN|EACCES|permission/i.test(output)
      ? 'دسترسی به فایل پایگاه داده ممکن نیست'
      : /SQLITE_BUSY|locked/i.test(output)
        ? 'پایگاه داده در حال استفاده است (سرور دیگری در حال اجراست)'
        : 'اجرای مهاجرت‌ها ناموفق بود';
    throw Object.assign(new Error(`${reason}: ${output}`), {
      step: 'database', command: 'node dist/cli/seed.js --catalog-only', exitCode: result.code, output,
    });
  }
  const applied = (result.stdout.match(/\[migrate\] applying/g) ?? []).length;
  const sizeKb = Math.round(fs.statSync(database).size / 1024);
  stepEvent('database', 'ایجاد و مهاجرت پایگاه داده', 'ok', {
    message: `${existed ? 'پایگاه داده موجود به‌روزرسانی شد' : 'پایگاه داده جدید ساخته شد'} · ${applied} مهاجرت جدید · ${sizeKb} KB`,
    detail: database,
    stepProgress: 100,
  });
}

async function stepAdmin(config, job) {
  stepEvent('admin', 'ایجاد حساب مدیر کل', 'running', { stepProgress: 20 });
  const admin = job.admin ?? {};
  const username = String(admin.username ?? '').trim();
  const password = String(admin.password ?? '');
  if (!username || !password) {
    stepEvent('admin', 'ایجاد حساب مدیر کل', 'skip', {
      message: 'اطلاعات مدیر کل داده نشد؛ می‌توانید بعداً با create-admin بسازید',
    });
    return { created: false };
  }
  if (DRY_RUN) {
    stepEvent('admin', 'ایجاد حساب مدیر کل', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return { created: false };
  }
  const result = await runProcess(
    process.execPath,
    ['--experimental-sqlite', 'dist/cli/create-admin.js', '--username', username, '--stdin',
      '--full-name', String(admin.fullName ?? 'مدیر سامانه'),
      ...(admin.mobile ? ['--mobile', String(admin.mobile)] : [])],
    {
      cwd: path.join(ROOT, 'apps/api'),
      env: { PISHKAN_ENV_FILE: config.file },
      input: `${password}\n`,
      timeoutMs: 120_000,
    },
  );
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0) {
    const reason = /حداقل|ترکیبی/.test(output) ? 'رمز عبور با سیاست امنیتی سازگار نیست' : 'ایجاد حساب مدیر ناموفق بود';
    throw Object.assign(new Error(`${reason}: ${tail(output, 8)}`), {
      step: 'admin', command: 'node dist/cli/create-admin.js --username … --stdin', exitCode: result.code, output: tail(output, 40),
    });
  }
  const created = /created/i.test(output) && !/already exists/i.test(output);
  stepEvent('admin', 'ایجاد حساب مدیر کل', 'ok', {
    message: created ? `حساب «${username}» با نقش مدیر کل ساخته شد` : `حساب مدیر از قبل وجود داشت («${username}» تغییر نکرد)`,
    stepProgress: 100,
  });
  return { created, username };
}

async function managerCommand(command, extra = []) {
  return runProcess(process.execPath, [path.join(MODULE_DIR, 'manager.mjs'), command, '--root', ROOT, ...extra], {
    timeoutMs: 180_000,
  });
}

async function stepStart(config) {
  stepEvent('start', 'راه‌اندازی سرویس‌ها', 'running', { stepProgress: 10 });
  if (NO_START) {
    stepEvent('start', 'راه‌اندازی سرویس‌ها', 'skip', { message: 'با درخواست کاربر رد شد' });
    return;
  }
  if (DRY_RUN) {
    stepEvent('start', 'راه‌اندازی سرویس‌ها', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return;
  }
  const result = await managerCommand('start', ['--json']);
  const payload = JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('RESULT_JSON:'))?.slice(12) ?? '{}');
  if (result.code !== 0 || !payload.ok) {
    throw Object.assign(new Error(payload.error || `راه‌اندازی ناموفق بود: ${tail(result.stderr || result.stdout, 10)}`), {
      step: 'start', command: 'node windows/lib/manager.mjs start', exitCode: result.code,
      output: tail(result.stderr || result.stdout, 40),
    });
  }
  stepEvent('start', 'راه‌اندازی سرویس‌ها', 'ok', {
    message: `سرور روی ${payload.url ?? `http://127.0.0.1:${config.port}`} پاسخ می‌دهد`,
    stepProgress: 100,
  });
}

async function stepVerify(config, job) {
  if (DRY_RUN) {
    stepEvent('verify', 'آزمون نهایی نصب', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return { checks: [], steps: [] };
  }
  stepEvent('verify', 'آزمون نهایی نصب', 'running', { stepProgress: 5 });
  const url = `http://127.0.0.1:${config.port}`;
  const mode = RUN_WORKFLOW ? 'workflow' : 'core';
  const verifyArgs = [path.join(MODULE_DIR, 'verify.mjs'), '--mode', mode, '--url', url, '--env', config.file];
  if (RUN_WORKFLOW) {
    verifyArgs.push('--admin-user', String(job.admin?.username ?? 'admin'), '--admin-pass', String(job.admin?.password ?? ''));
  }
  const result = await runProcess(process.execPath, verifyArgs, {
    timeoutMs: 10 * 60 * 1000,
    onLine: (line) => {
      if (line.startsWith('[PASS]') || line.startsWith('[FAIL]') || line.startsWith('[STEP]')) {
        stepEvent('verify', 'آزمون نهایی نصب', 'running', {
          append: false, message: line.replace(/^\[\w+\]\s*/, ''), stepProgress: 40,
        });
      }
    },
  });
  const payload = JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('RESULT_JSON:'))?.slice(12) ?? '{}');
  if (result.code !== 0 || !payload.ok) {
    const failed = (payload.failed ?? []).join(' | ') || tail(result.stderr, 10);
    throw Object.assign(new Error(`آزمون نهایی ناموفق بود: ${failed}`), {
      step: 'verify', command: `node windows/lib/verify.mjs --mode ${mode}`, exitCode: result.code,
      output: tail(result.stderr, 40), details: payload.failed,
    });
  }
  const passed = (payload.checks ?? []).filter((c) => c.ok).length;
  stepEvent('verify', 'آزمون نهایی نصب', 'ok', {
    message: `${passed} بررسی و ${payload.steps?.length ?? 0} گام گردش‌کار تأیید شد`,
    stepProgress: 100,
  });
  return payload;
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  const job = await readJobFromStdin();
  log(`نصب Pishkan در «${ROOT}» آغاز شد.`);

  let config;
  try {
    config = await stepEnv(job);
    await stepDependencies();
    await stepBuild();
    await stepDatabase(config);
    await stepAdmin(config, job);
    await stepStart(config);
    const verification = await stepVerify(config, job);

    const report = {
      ok: true,
      installedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      root: ROOT,
      url: `http://127.0.0.1:${config.port}`,
      port: config.port,
      envFile: config.file,
      database: config.database,
      databaseDriver: 'sqlite',
      dataDir: dataDir(ROOT),
      admin: job.admin?.username ? { username: job.admin.username, createdByInstaller: true } : null,
      steps: events.steps.filter((s) => ['ok', 'skip'].includes(s.status)),
      verification: { checks: verification.checks?.length ?? 0, steps: verification.steps?.length ?? 0 },
      node: process.versions.node,
      platform: process.platform,
      artifacts: {
        log: logFile(ROOT),
        errorLog: errorLogFile(ROOT),
        credentialsNote: 'گذرواژه مدیر کل در هیچ فایلی ذخیره نمی‌شود.',
      },
    };
    if (!DRY_RUN) writeJson(installReportPath(ROOT), report);
    emit({ type: 'result', ok: true, report, durationMs: report.durationMs });
    process.exit(0);
  } catch (error) {
    const detail = {
      ok: false,
      failedAt: new Date().toISOString(),
      root: ROOT,
      step: error?.step ?? events.steps.at(-1)?.id ?? 'unknown',
      stepTitle: events.steps.at(-1)?.title ?? '',
      message: error?.message ?? String(error),
      command: error?.command ?? null,
      exitCode: error?.exitCode ?? null,
      output: error?.output ?? null,
      hints: [
        'اتصال شبکه و دسترسی به registry.npmjs.org را بررسی کنید.',
        'اگر پورت اشغال است، پورت دیگری در صفحه نصب انتخاب کنید.',
        'برای جزئیات کامل، فایل گزارش خطا را باز کنید.',
      ],
      durationMs: Date.now() - startedAt.getTime(),
    };
    if (!DRY_RUN) {
      try { writeJson(errorReportPath(ROOT), detail); } catch { /* disk full etc. */ }
    }
    stepEvent(detail.step, detail.stepTitle || 'خطا', 'fail', { message: detail.message });
    emit({ type: 'result', ok: false, error: detail, durationMs: detail.durationMs });
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`fatal: ${error?.stack ?? error}\n`);
  process.exit(2);
});
