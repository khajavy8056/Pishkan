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
  isPortBusy, findFreePort, parseArgs, pidAlive, readJson, sleep, stateFile, uploadDir, writeJson,
} from './common.mjs';
import { readEnvFile, upsertEnvFile } from './envfile.mjs';
import { privateLanUrls, resolveLanAccess } from './lan-access.mjs';
import { runLanFirewall } from './lan-firewall.mjs';

const args = parseArgs();
const ROOT = path.resolve(args.get('root', DEFAULT_ROOT));
const JSON_LINES = args.has('json-lines');
const DRY_RUN = args.has('dry-run');
const SKIP_DEPS = args.has('skip-deps');
const SKIP_BUILD = args.has('skip-build');
const NO_START = args.has('no-start');
const RUN_WORKFLOW = args.has('verify-workflow');
const SKIP_NETWORK = args.has('skip-network') || DRY_RUN;
const SKIP_CHECKS = args.has('skip-checks') || DRY_RUN;

const startedAt = new Date();
const events = { steps: [], logs: [] };
/** Set when this run skipped admin creation and no admin existed before it. */
let adminMissing = false;
/** Set once this run started the server, so a later failure can stop it again. */
let serverStartedHere = false;

function emit(event) {
  if (JSON_LINES) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }
  if (event.type === 'step') {
    const mark = event.status === 'ok' ? '✓' : event.status === 'fail' ? '✗' : event.status === 'warn' ? '!' : event.status === 'skip' ? '–' : '…';
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
const WEIGHTS = { check: 3, clean: 1, env: 2, lan: 2, deps: 39, build: 18, database: 13, admin: 6, start: 6, verify: 10 };
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
  if (status === 'ok' || status === 'skip' || status === 'fail' || status === 'warn') {
    if (!events.steps.some((s) => s.id === id && ['ok', 'fail', 'skip', 'warn'].includes(s.status))) {
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
  // `shell: true` is required for npm.cmd on Windows, but it makes Node join the
  // arguments with spaces without quoting them — so it must never be used for the
  // node executable with an absolute script path (e.g. "C:\My Projects\…").
  const shell = options.shell ?? false;
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell,
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

/**
 * Read the job JSON from stdin.
 *
 * The sender is PowerShell, and ConvertTo-Json in Windows PowerShell 5.1
 * *pretty-prints* unless -Compress is used — it once sent a JSON object spread
 * over a dozen lines, this function took only the first line ("{") and the
 * installer died with «ورودی تنظیمات نصب‌کننده معتبر نیست (JSON)» on a real
 * machine. So: never trust the framing. Strip a UTF-8 BOM, try the whole text,
 * then fall back to the first complete JSON object in it.
 */
function parseJobText(raw) {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) return null;
  const candidates = [text];
  // Windows line endings, a trailing newline, or a log line before the JSON.
  candidates.push(text.split(/\r?\n/).filter((line) => line.trim()).join('\n'));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch { /* try the next shape */ }
  }
  // Last resort: the first balanced {...} block (tolerates extra output around it).
  const start = text.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const value = JSON.parse(text.slice(start, i + 1));
            if (value && typeof value === 'object') return value;
          } catch { /* fall through */ }
          break;
        }
      }
    }
  }
  return undefined;
}

async function readJobFromStdin() {
  if (!args.has('job-stdin')) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  const job = parseJobText(raw);
  if (job === undefined) {
    throw new Error(
      'ورودی تنظیمات نصب‌کننده معتبر نیست (JSON). ' +
      `طول دریافت‌شده: ${raw.trim().length} کاراکتر، ابتدا: ${JSON.stringify(raw.trim().slice(0, 120))}`,
    );
  }
  return job ?? {};
}

function randomHex(bytes) {
  const buffer = Buffer.alloc(bytes);
  crypto.getRandomValues(buffer);
  return buffer.toString('hex');
}

/* ------------------------------- the steps -------------------------------- */

/**
 * Pre-flight check, run by the engine itself so that a console install and a
 * scripted install get the same protection as the GUI: Windows build, Node and
 * npm versions, free disk space, write access, network reachability and a free
 * port. `syscheck.mjs` is the single source of truth for the rules.
 */
async function stepChecks(job = {}) {
  if (SKIP_CHECKS) {
    stepEvent('check', 'بررسی سیستم', 'skip', { message: 'با درخواست کاربر رد شد' });
    return null;
  }
  stepEvent('check', 'بررسی سیستم', 'running', { stepProgress: 10 });
  const existingConfig = readEnvFile(envFilePath(ROOT));
  const checkPort = Number(job.port || args.get('port', String(existingConfig.PORT || DEFAULT_PORT)));
  const checkArgs = [path.join(MODULE_DIR, 'syscheck.mjs'), '--root', ROOT, '--port', String(checkPort)];
  if (SKIP_NETWORK) checkArgs.push('--skip-network');
  const result = await runProcess(process.execPath, checkArgs, { cwd: ROOT, timeoutMs: 120_000 });
  const line = `${result.stdout}\n${result.stderr}`.split('\n').find((row) => row.startsWith('RESULT_JSON:'));
  let payload = null;
  try { payload = line ? JSON.parse(line.slice(12)) : null; } catch { payload = null; }
  if (!payload) {
    stepEvent('check', 'بررسی سیستم', 'fail', { message: tail(`${result.stdout}\n${result.stderr}`, 6) });
    throw Object.assign(new Error('بررسی سیستم اجرا نشد'), {
      step: 'check', command: 'node windows/lib/syscheck.mjs', exitCode: result.code, output: tail(result.stderr || result.stdout, 40),
    });
  }
  for (const item of payload.items ?? []) {
    if (item.status === 'ok') continue;
    log(`${item.status === 'fail' ? '⛔' : '⚠️'} ${item.title} — ${item.detail}${item.remediation ? ` · ${item.remediation}` : ''}`,
      item.status === 'fail' ? 'error' : 'warn');
  }
  if (!payload.ok) {
    stepEvent('check', 'بررسی سیستم', 'fail', {
      message: `موارد مسدودکننده: ${(payload.failures ?? []).join('، ')}`,
    });
    throw Object.assign(new Error(`پیش‌نیازهای نصب برآورده نشد: ${(payload.failures ?? []).join('، ')}`), {
      step: 'check', command: 'node windows/lib/syscheck.mjs', exitCode: 1,
      output: tail(JSON.stringify(payload.items ?? [], null, 2), 40),
    });
  }
  const warnings = payload.warnings ?? [];
  stepEvent('check', 'بررسی سیستم', 'ok', {
    message: `${(payload.items ?? []).length} مورد بررسی شد${warnings.length ? ` · ${warnings.length} هشدار` : ''}`,
    stepProgress: 100,
  });
  return payload;
}

/** Fail fast on a structurally invalid job — before anything destructive. */
function validateJobShape(job) {
  if (job.cleanInstall !== undefined && typeof job.cleanInstall !== 'boolean') {
    throw Object.assign(new Error('گزینهٔ نصب تمیز باید روشن/خاموش باشد.'), { step: 'job' });
  }
  const admin = job.admin;
  if (admin !== undefined && admin !== null) {
    // A string/array here means the launcher serialized the admin block
    // incorrectly (historically: a PowerShell scriptblock `{}` instead of a
    // hashtable `@{}` in the GUI job). Surface that loudly instead of
    // silently installing a system nobody can log into.
    if (typeof admin !== 'object' || Array.isArray(admin)) {
      throw Object.assign(new Error('اطلاعات مدیر کل در درخواست نصب به‌درستی نرسیده است؛ کد پروژه را به‌روز کنید و نصب را دوباره اجرا کنید.'), { step: 'job' });
    }
    for (const key of ['username', 'password', 'fullName', 'mobile']) {
      if (admin[key] !== undefined && typeof admin[key] !== 'string') {
        throw Object.assign(new Error(`اطلاعات مدیر کل معتبر نیست (${key}).`), { step: 'job' });
      }
    }
  }
}

async function countExistingAdmins(databaseFile) {
  try {
    if (!databaseFile || !fs.existsSync(databaseFile)) return 0;
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE kind = 'admin' AND status = 'active'").get();
      return Number(row?.c ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

/**
 * Clean install (explicit opt-in): before any configuration is read, move the
 * previous installation's database + env aside and drop stale build output so
 * this run starts from zero. Files are quarantined under
 * .data/previous-install-<timestamp>/ instead of being hard-deleted — the new
 * install never sees them, but a human can still recover them.
 */
async function stepClean(job) {
  if (job.cleanInstall !== true) return;
  stepEvent('clean', 'پاک‌سازی نصب قبلی', 'running', { stepProgress: 10 });
  if (DRY_RUN) {
    stepEvent('clean', 'پاک‌سازی نصب قبلی', 'skip', { message: 'حالت آزمایشی (dry-run)؛ هیچ داده‌ای جابه‌جا نمی‌شود', stepProgress: 100 });
    return;
  }
  // The database file cannot be moved while our own server holds it open.
  try { await managerCommand('stop', ['--json']); } catch { /* not running: fine */ }

  const envFile = envFilePath(ROOT);
  const existing = readEnvFile(envFile);
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const quarantine = path.join(dataDir(ROOT), `previous-install-${stamp}`);
  const moved = [];
  const moveAside = (from) => {
    if (!from || !fs.existsSync(from)) return;
    fs.mkdirSync(quarantine, { recursive: true });
    const to = path.join(quarantine, path.basename(from));
    try {
      fs.renameSync(from, to);
    } catch {
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
    }
    moved.push(path.basename(from));
  };
  try {
    const dbCandidates = new Set(
      [existing.SQLITE_FILE, dbFile(ROOT)]
        .filter(Boolean)
        .map((candidate) => (path.isAbsolute(candidate) ? candidate : path.join(ROOT, candidate))),
    );
    for (const db of dbCandidates) {
      moveAside(db);
      moveAside(`${db}-wal`);
      moveAside(`${db}-shm`);
    }
    moveAside(envFile);
    try {
      for (const name of fs.readdirSync(ROOT)) {
        if (name.startsWith('.env.windows.local.bak')) moveAside(path.join(ROOT, name));
      }
    } catch { /* env backups are optional */ }
    moveAside(path.join(dataDir(ROOT), 'initial-admin-credentials.txt'));
    moveAside(stateFile(ROOT));
    for (const dist of ['apps/api/dist', 'apps/web/dist']) {
      fs.rmSync(path.join(ROOT, dist), { recursive: true, force: true });
    }
  } catch (error) {
    throw Object.assign(new Error(`پاک‌سازی نصب قبلی کامل نشد: ${error?.message ?? error} — اگر سرور Pishkan در حال اجراست ابتدا آن را متوقف کنید (Stop-Pishkan) و دوباره تلاش کنید.`), { step: 'clean' });
  }
  stepEvent('clean', 'پاک‌سازی نصب قبلی', moved.length ? 'ok' : 'skip', {
    message: moved.length
      ? `داده‌های نصب قبلی به «.data/previous-install-${stamp}» منتقل شد (${moved.length} فایل)؛ نصب از صفر آغاز می‌شود`
      : 'داده‌ای از نصب قبلی پیدا نشد؛ نصب از صفر آغاز می‌شود',
    stepProgress: 100,
  });
}

async function stepEnv(job) {
  stepEvent('env', 'آماده‌سازی تنظیمات محلی', 'running', { stepProgress: 5 });
  const file = envFilePath(ROOT);
  const existing = readEnvFile(file);
  const requestedPort = Number(job.port || args.get('port', String(existing.PORT || DEFAULT_PORT)));
  const reinstall = fs.existsSync(file) && Object.keys(existing).length > 0;
  const database = existing.SQLITE_FILE || dbFile(ROOT);

  let port = requestedPort;
  // If this installation's own server is already running on the configured
  // port, keep that port. Picking a "free" one would silently move a working
  // installation to a new address on every reinstall.
  const runningState = readJson(stateFile(ROOT), null);
  const ourServerRunning = Boolean(runningState?.pid)
    && runningState.root === ROOT
    && Number(runningState.port) === requestedPort
    && pidAlive(runningState.pid)
    && (await isPortBusy(requestedPort));
  if (ourServerRunning) {
    log(`سرور این نصب از قبل روی پورت ${port} در حال اجراست؛ همان پورت حفظ شد.`);
  } else if (await isPortBusy(port)) {
    const free = await findFreePort(port + 1);
    if (!free) throw new Error(`پورت ${port} در حال استفاده است و پورت آزاد دیگری پیدا نشد.`);
    log(`پورت ${port} در حال استفاده بود؛ از پورت آزاد ${free} استفاده می‌شود.`, 'warn');
    port = free;
  }

  if (job.lanAccess !== undefined && typeof job.lanAccess !== 'boolean') {
    throw Object.assign(new Error('گزینهٔ دسترسی LAN باید روشن/خاموش باشد.'), { step: 'lan' });
  }
  let lan = resolveLanAccess(job.lanAccess, existing);
  const wasLanEnabled = String(existing.LAN_ACCESS ?? '').toLowerCase() === 'true';
  let firewallWarning = '';
  if (lan.enabled) {
    stepEvent('lan', 'دسترسی شبکه محلی', 'running', { stepProgress: 10 });
    if (DRY_RUN) {
      stepEvent('lan', 'دسترسی شبکه محلی', 'skip', { message: 'dry-run: فقط فایل تنظیمات نمونه ساخته می‌شود و فایروال تغییر نمی‌کند.' });
    } else {
      const firewall = runLanFirewall('ensure', { root: ROOT, port, program: process.execPath });
      if (!firewall.ok) {
        // LAN no longer dies with the firewall. The rule is best-effort: the
        // firewall may be off entirely (then phones already connect) or the
        // rule may just need one elevated confirmation later. Keep LAN enabled
        // in the written config and point the operator to the Manager's
        // one-click «باز کردن فایروال برای موبایل» instead of silently
        // degrading the whole install to loopback-only.
        firewallWarning = firewall.message;
        log(`قانون فایروال LAN ساخته نشد؛ نصب با دسترسی LAN ادامه می‌یابد. دلیل: ${firewall.message}`, 'warn');
        stepEvent('lan', 'دسترسی شبکه محلی', 'warn', {
          message: `قانون فایروال ساخته نشد (${firewall.message}) اما نصب با دسترسی LAN ادامه می‌یابد. اگر گوشی به سامانه وصل نشد، بعد از نصب در «Pishkan Manager» دکمهٔ «📱 باز کردن فایروال برای موبایل» را بزنید (فقط یک تأیید Windows لازم دارد).`,
          stepProgress: 100,
        });
      } else {
        stepEvent('lan', 'دسترسی شبکه محلی', 'ok', {
          message: 'فایروال فقط Private/LocalSubnet را مجاز و Public/Domain را مسدود می‌کند.', stepProgress: 100,
        });
      }
    }
  } else if (wasLanEnabled) {
    stepEvent('lan', 'دسترسی شبکه محلی', 'running', { stepProgress: 10 });
    if (DRY_RUN) {
      stepEvent('lan', 'دسترسی شبکه محلی', 'skip', { message: 'dry-run: قانون فایروال موجود دست‌نخورده می‌ماند.' });
    } else {
      if (ourServerRunning) {
        const stopped = await managerCommand('stop', ['--json']);
        const stopPayload = JSON.parse(stopped.stdout.split('\n').find((line) => line.startsWith('RESULT_JSON:'))?.slice(12) ?? '{}');
        if (stopped.code !== 0 || !stopPayload.ok) {
          const message = stopPayload.message || 'سرور قبلی LAN پیش از خاموش‌کردن فایروال متوقف نشد.';
          stepEvent('lan', 'دسترسی شبکه محلی', 'fail', { message });
          throw Object.assign(new Error(message), { step: 'lan', output: tail(stopped.stderr || stopped.stdout, 20) });
        }
      }
      const firewall = runLanFirewall('remove', { root: ROOT, port: Number(existing.PORT || port), program: process.execPath });
      if (!firewall.ok) {
        firewallWarning = firewall.message;
        log(`توجه: ${firewall.message} سرویس در تنظیم جدید فقط روی loopback اجرا خواهد شد.`, 'warn');
        stepEvent('lan', 'دسترسی شبکه محلی', 'warn', { message: 'اتصال LAN خاموش شد؛ حذف قانون فایروال به دسترسی Administrator نیاز دارد.' });
      } else {
        stepEvent('lan', 'دسترسی شبکه محلی', 'ok', { message: firewall.message, stepProgress: 100 });
      }
    }
  } else {
    stepEvent('lan', 'دسترسی شبکه محلی', DRY_RUN ? 'skip' : 'skip', {
      message: DRY_RUN ? 'dry-run: دسترسی پیش‌فرض loopback حفظ شد.' : 'پیش‌فرض امن؛ برنامه فقط روی همین رایانه در دسترس است.',
    });
  }

  const values = {
    NODE_ENV: 'development',
    DB_DRIVER: 'sqlite',
    SQLITE_FILE: database.replace(/\\/g, '/'),
    HOST: lan.host,
    LAN_ACCESS: lan.value,
    PORT: String(port),
    // APP_URL/API_URL stay loopback: browser requests use same-origin relative
    // paths. External Zarinpal callbacks use a separately configured public HTTPS base.
    APP_URL: `http://127.0.0.1:${port}`,
    API_URL: `http://127.0.0.1:${port}`,
    ZARINPAL_CALLBACK_BASE_URL: existing.ZARINPAL_CALLBACK_BASE_URL || '',
    CORS_ORIGINS: `http://127.0.0.1:${port}`,
    COOKIE_SECURE: 'false',
    APP_ENCRYPTION_KEY: existing.APP_ENCRYPTION_KEY || randomHex(32),
    UPLOAD_DIR: (existing.UPLOAD_DIR || uploadDir(ROOT)).replace(/\\/g, '/'),
    BACKUP_DIR: (existing.BACKUP_DIR || backupDir(ROOT)).replace(/\\/g, '/'),
    PISHKAN_CONTROL_PIPE: existing.PISHKAN_CONTROL_PIPE || controlPipePath(ROOT),
    DEMO_MODE: existing.DEMO_MODE || 'false',
    LOG_LEVEL: existing.LOG_LEVEL || 'info',
    // The local app is one machine and every automated check (installer verify,
    // manager «آزمون گردش‌کار») logs in several times per run from the same IP.
    // The shared default of 15 logins / 5 minutes is too tight here: three runs
    // in a row end with «تلاش‌های ورود بیش از حد مجاز». 60 keeps brute-force
    // protection meaningful while letting a human retry the checks.
    AUTH_LOGIN_RATE_LIMIT: existing.AUTH_LOGIN_RATE_LIMIT || '60',
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
    message: `${reinstall ? 'تنظیمات موجود بازبینی شد' : 'فایل تنظیمات ساخته شد'} · پورت ${port} · ${lan.enabled ? 'LAN با فایروال محدود' : 'فقط loopback'}`,
    detail: file,
    stepProgress: 100,
  });
  return {
    port, file, values, reinstall, database,
    lanAccess: lan.enabled,
    mobileUrls: process.platform === 'win32' && lan.enabled && !DRY_RUN ? privateLanUrls(port) : [],
    firewallWarning,
  };
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

async function stepDependencies({ forceClean = false, recovery = false } = {}) {
  const nodeModules = path.join(ROOT, 'node_modules');
  const expected = expectedPackageCount();
  if (SKIP_DEPS) {
    stepEvent('deps', 'دانلود وابستگی‌ها', 'skip', { message: 'با درخواست کاربر رد شد' });
    return;
  }
  // A package count cannot prove that this version's dependencies are present.
  // Always let npm reconcile the workspace and lockfile, including build-time
  // dependencies; reuse the npm cache/tree on repairs rather than deleting it.
  const installed = countInstalledPackages(nodeModules);
  if (DRY_RUN) {
    stepEvent('deps', 'دانلود وابستگی‌ها', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return;
  }

  const hasLock = fs.existsSync(path.join(ROOT, 'package-lock.json'));
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // Home connections drop; npm's default is 2 retries and a 5 minute timeout,
  // which is not enough for 670 packages on a slow line. These flags make npm
  // keep trying instead of failing the whole installation.
  const npmNetwork = [
    '--no-audit', '--no-fund', '--loglevel=error', '--include=dev', '--include=optional', '--ignore-scripts=false',
    '--fetch-retries=5', '--fetch-retry-mintimeout=5000', '--fetch-retry-maxtimeout=120000',
    '--fetch-timeout=300000',
  ];
  // `npm ci` is appropriate on a fresh install (or one explicit recovery);
  // on an existing install, npm install preserves and repairs the tree/cache.
  let mode = hasLock && (forceClean || installed === 0) ? 'ci' : 'install';
  let npmArgs = [mode, ...npmNetwork];
  const attempts = 3;
  stepEvent('deps', 'دانلود وابستگی‌ها', 'running', {
    message: `${recovery ? 'بازسازی وابستگی‌های ناقص' : 'بررسی و همگام‌سازی وابستگی‌ها'} · npm ${mode} · ${expected || '?'} بسته`,
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
        progress: recovery ? completedWeight : Math.round(completedWeight + (WEIGHTS.deps ?? 0) * ratio),
      });
    }, 900);

    const result = await runProcess(npmCommand, npmArgs, {
      shell: process.platform === 'win32',
      timeoutMs: 45 * 60 * 1000,
      onLine: (line) => {
        if (/ERR!|error|warn EBADENGINE/i.test(line)) log(line.slice(0, 300), 'warn');
      },
    });
    clearInterval(timer);
    const extracted = countInstalledPackages(nodeModules);

    if (result.code === 0) {
      // Verify the installed dependency graph instead of assuming a successful
      // npm exit or a large folder means the workspace is complete.
      const validation = await runProcess(npmCommand, ['ls', '--all', '--include=dev', '--include=optional', '--parseable', '--loglevel=error'], {
        shell: process.platform === 'win32', timeoutMs: 5 * 60 * 1000,
      });
      if (validation.code !== 0) {
        throw Object.assign(new Error(`بررسی وابستگی‌ها ناموفق بود: ${tail(validation.stderr || validation.stdout, 12)}`), {
          step: 'deps', command: 'npm ls --all --include=dev --include=optional', exitCode: validation.code,
          output: tail(validation.stderr || validation.stdout, 40),
        });
      }
      stepEvent('deps', 'دانلود وابستگی‌ها', 'ok', {
        message: `${extracted} بسته بررسی و همگام شد · ${formatBytes(dirSizeBytes(nodeModules))}`,
        stepProgress: 100,
      });
      return;
    }
    const hint = result.timedOut
      ? 'زمان دانلود به پایان رسید'
      : /ETIMEDOUT|ENOTFOUND|ECONNRESET|network|EAI_AGAIN/i.test(result.stderr + result.stdout)
        ? 'اتصال شبکه قطع شد'
        : 'npm با خطا تمام شد';
    // A package-lock.json that does not match package.json makes `npm ci` refuse
    // to run (EUSAGE). That is a package defect, not a network problem: retrying
    // the same command cannot succeed, but `npm install` repairs the tree.
    if (mode === 'ci' && /EUSAGE|can only install with an existing package-lock|npm ci can only/i.test(result.stderr + result.stdout)) {
      log('package-lock.json با package.json هم‌خوان نیست؛ به‌جای npm ci از npm install استفاده می‌شود.', 'warn');
      mode = 'install';
      npmArgs = [mode, ...npmNetwork];
      continue;
    }
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

function buildOutputForError(result) {
  return [result.stderr, result.stdout].filter(Boolean).join('\n');
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
  let repairedDependencies = false;
  for (const [index, workspace] of ['apps/api', 'apps/web'].entries()) {
    const build = () => runProcess(npmCommand, ['run', 'build', '--workspace', workspace], {
      shell: process.platform === 'win32',
      timeoutMs: 30 * 60 * 1000,
      onLine: (line) => {
        if (/error/i.test(line)) log(line.slice(0, 300), 'warn');
      },
    });
    let result = await build();
    // npm's dependency graph can still look valid when files inside a package
    // are damaged. For missing-module build failures only, do one clean rebuild
    // of node_modules and retry. Never override an explicit --skip-deps.
    const buildOutput = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0 && !SKIP_DEPS && !repairedDependencies && fs.existsSync(path.join(ROOT, 'package-lock.json')) &&
        /TS2307: Cannot find module|TS7016: Could not find a declaration file|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find package|Could not resolve/i.test(buildOutput)) {
      repairedDependencies = true;
      log('بسته‌ای در زمان ساخت پیدا نشد؛ وابستگی‌ها یک‌بار از نو نصب و ساخت دوباره اجرا می‌شود. داده‌ها و پایگاه داده دست‌نخورده می‌مانند.', 'warn');
      await stepDependencies({ forceClean: true, recovery: true });
      result = await build();
    }
    if (result.code !== 0) {
      throw Object.assign(new Error(`ساخت ${workspace} ناموفق بود: ${tail(buildOutputForError(result), 12)}`), {
        step: 'build', command: `npm run build --workspace ${workspace}`, exitCode: result.code,
        output: tail(buildOutputForError(result), 40),
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
  if (DRY_RUN) {
    stepEvent('admin', 'ایجاد حساب مدیر کل', 'skip', { message: 'حالت آزمایشی (dry-run)' });
    return { created: false };
  }
  if (!username || !password) {
    // Never finish a «successful» install that nobody can log into. Skipping
    // is only legitimate when an active admin already exists (e.g. a repair
    // run that intentionally left the account untouched).
    const admins = await countExistingAdmins(config.database);
    if (admins > 0) {
      adminMissing = true;
      stepEvent('admin', 'ایجاد حساب مدیر کل', 'skip', {
        message: `اطلاعات مدیر کل داده نشد؛ ${admins} حساب مدیر فعال از قبل وجود دارد و همان معتبر می‌ماند`,
      });
      return { created: false };
    }
    stepEvent('admin', 'ایجاد حساب مدیر کل', 'fail', {
      message: 'هیچ حساب مدیر کلی وجود ندارد و اطلاعات ساخت آن داده نشده است',
    });
    throw Object.assign(new Error('هیچ حساب مدیر کلی وجود ندارد و اطلاعات ساخت آن داده نشده است؛ در پنجرهٔ نصب بخش «حساب مدیر کل» (نام، نام کاربری و رمز عبور) را کامل کنید و نصب را دوباره اجرا کنید.'), { step: 'admin' });
  }
  const result = await runProcess(
    process.execPath,
    ['--experimental-sqlite', 'dist/cli/create-admin.js', '--username', username, '--stdin', '--upsert',
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
    const reason = /username-taken/.test(output)
      ? 'این نام کاربری برای حساب دیگری (غیرمدیر) ثبت شده است؛ نام کاربری دیگری برای مدیر کل انتخاب کنید'
      : /حداقل|ترکیبی/.test(output) ? 'رمز عبور با سیاست امنیتی سازگار نیست' : 'ایجاد حساب مدیر ناموفق بود';
    throw Object.assign(new Error(`${reason}: ${tail(output, 8)}`), {
      step: 'admin', command: 'node dist/cli/create-admin.js --username … --stdin', exitCode: result.code, output: tail(output, 40),
    });
  }
  const updated = /account updated/i.test(output);
  const verified = !updated && /account verified/i.test(output);
  const created = !updated && !verified && /created/i.test(output) && !/already exists/i.test(output);
  stepEvent('admin', 'ایجاد حساب مدیر کل', 'ok', {
    message: updated
      ? `حساب مدیر کل «${username}» از قبل وجود داشت؛ رمز عبور آن به رمز واردشده تغییر کرد تا ورود با همین اطلاعات ممکن باشد`
      : verified
        ? `حساب مدیر کل «${username}» از قبل با همین رمز عبور وجود داشت`
        : created
          ? `حساب «${username}» با نقش مدیر کل ساخته شد`
          : `حساب مدیر کل «${username}» آمادهٔ ورود است`,
    stepProgress: 100,
  });
  return { created, updated, verified, username };
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
    throw Object.assign(new Error(payload.error || payload.message || `راه‌اندازی ناموفق بود: ${tail(result.stderr || result.stdout, 10)}`), {
      step: 'start', command: 'node windows/lib/manager.mjs start', exitCode: result.code,
      output: tail(result.stderr || result.stdout, 40),
    });
  }
  serverStartedHere = true;
  if (config.lanAccess && Array.isArray(payload.mobileUrls)) config.mobileUrls = payload.mobileUrls;
  const mobileText = config.lanAccess
    ? (payload.mobileUrls?.length ? ` · آدرس موبایل: ${payload.mobileUrls.join('، ')}` : ' · LAN فعال است؛ ابتدا این رایانه را به Wi‑Fi دفتر وصل کنید و Manager را تازه‌سازی کنید.')
    : ' · دسترسی شبکه خاموش و محدود به همین رایانه است.';
  stepEvent('start', 'راه‌اندازی سرویس‌ها', 'ok', {
    message: `سرور روی ${payload.url ?? `http://127.0.0.1:${config.port}`} پاسخ می‌دهد${mobileText}`,
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
  const verifyArgs = [
    path.join(MODULE_DIR, 'verify.mjs'), '--mode', mode, '--url', url, '--env', config.file, '--root', ROOT,
  ];
  // Without an admin account the application is installed but cannot be used.
  // The installer only warns in that case (a human can create the account
  // later); a *wrong* installation still fails on every other check.
  if (adminMissing) verifyArgs.push('--allow-missing-admin');
  // Always prove the installer-entered credentials can actually log in — not
  // only in workflow mode. An install that «succeeds» while the typed admin
  // password does not work is the exact failure this guards against. The
  // password travels via the environment, never the process argv.
  const adminUser = String(job.admin?.username ?? '').trim();
  const adminPass = String(job.admin?.password ?? '');
  const verifyEnv = !adminMissing && adminUser && adminPass
    ? { PISHKAN_ADMIN_USER: adminUser, PISHKAN_ADMIN_PASS: adminPass }
    : {};
  const result = await runProcess(process.execPath, verifyArgs, {
    env: verifyEnv,
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
  let job;
  try {
    job = await readJobFromStdin();
  } catch (error) {
    // A malformed job must still end with a machine-readable result: the GUI
    // reads it to show a Persian message instead of a Node stack trace.
    const message = error?.message ?? String(error);
    log(message, 'error');
    const detail = {
      ok: false,
      failedAt: new Date().toISOString(),
      root: ROOT,
      step: 'job',
      stepTitle: 'تنظیمات نصب',
      message,
      hints: ['تنظیمات را دوباره در پنجرهٔ نصب وارد کنید یا نصب متنی را با PishkanSetup.cmd /console اجرا کنید.'],
    };
    if (!DRY_RUN) {
      try { writeJson(errorReportPath(ROOT), detail); } catch { /* ignore */ }
    }
    emit({ type: 'result', ok: false, error: detail, durationMs: Date.now() - startedAt.getTime() });
    process.exit(1);
  }
  log(`نصب Pishkan در «${ROOT}» آغاز شد.`);

  let config;
  let checks = null;
  try {
    validateJobShape(job);
    checks = await stepChecks(job);
    await stepClean(job);
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
      adminLoginUrl: `http://127.0.0.1:${config.port}/login-admin`,
      port: config.port,
      lanAccess: config.lanAccess,
      mobileUrls: config.mobileUrls,
      firewallWarning: config.firewallWarning || null,
      envFile: config.file,
      database: config.database,
      databaseDriver: 'sqlite',
      dataDir: dataDir(ROOT),
      admin: job.admin?.username ? { username: job.admin.username, createdByInstaller: true } : null,
      steps: events.steps.filter((s) => ['ok', 'skip', 'warn'].includes(s.status)),
      verification: { checks: verification.checks?.length ?? 0, steps: verification.steps?.length ?? 0 },
      preflight: checks ? { items: checks.items?.length ?? 0, warnings: checks.warnings ?? [] } : null,
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
    // A half-finished installation must not leave a server running: otherwise the
    // next attempt finds the port busy, silently moves to another port and the
    // user ends up with two servers and a report that says «موفق».
    let stoppedServer = false;
    if (serverStartedHere && !DRY_RUN) {
      try {
        const result = await managerCommand('stop', ['--json']);
        stoppedServer = result.code === 0;
        if (stoppedServer) log('سرور نیمه‌کارهٔ این نصب پس از خطا متوقف شد.');
      } catch { /* best effort: the report below still explains the failure */ }
    }
    const detail = {
      ok: false,
      failedAt: new Date().toISOString(),
      root: ROOT,
      stoppedServer,
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
