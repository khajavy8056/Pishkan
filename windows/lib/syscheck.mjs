/**
 * System check for the Pishkan local Windows installation.
 *
 * Emits a JSON document on stdout (prefixed with RESULT_JSON:) that the GUI
 * renders as a checklist. Every item carries a Persian title, a status
 * (`ok` | `warn` | `fail`), a human detail and — when something must be fixed —
 * a `remediation` string with the exact action.
 *
 * Nothing here is Windows-only: on Linux/macOS the platform item says so, which
 * is how the automated tests exercise this file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  MIN_NODE_VERSION, compareVersions, dataDir, dirSizeBytes, envFilePath,
  findFreePort, formatBytes, freeSpaceKb, isPortBusy, parseArgs, DEFAULT_ROOT,
} from './common.mjs';

const args = parseArgs();
const root = path.resolve(args.get('root', DEFAULT_ROOT));
const port = Number(args.get('port', '3000'));
const skipNetwork = args.has('skip-network');

const items = [];
function add(id, title, status, detail, remediation = '') {
  items.push({ id, title, status, detail, remediation });
  process.stderr.write(`[${status.toUpperCase()}] ${title} — ${detail}\n`);
}

function commandVersion(command, commandArgs) {
  try {
    return String(execFileSync(command, commandArgs, { encoding: 'utf8', timeout: 15000, shell: process.platform === 'win32' })).trim();
  } catch {
    return '';
  }
}

/* ------------------------------- platform -------------------------------- */

add(
  'platform',
  'سیستم‌عامل',
  process.platform === 'win32' ? 'ok' : 'warn',
  `${os.type()} ${os.release()} · ${os.arch()}`,
  process.platform === 'win32' ? '' : 'این اجرا برای آزمون روی لینوکس است؛ نصب واقعی باید روی Windows 10/11 انجام شود.',
);

if (process.platform === 'win32') {
  const build = Number.parseInt(os.release().split('.')[2] ?? '0', 10);
  const supported = build >= 19041;
  add(
    'windows-version',
    'نسخه Windows',
    supported ? 'ok' : 'fail',
    `Build ${build}${build >= 22000 ? ' (Windows 11)' : build >= 19041 ? ' (Windows 10 2004+)' : ''}`,
    supported ? '' : 'Windows 10 نسخه 2004 (Build 19041) یا جدیدتر لازم است.',
  );
  add('arch', 'معماری پردازنده', ['x64', 'arm64'].includes(os.arch()) ? 'ok' : 'warn',
    os.arch() === 'x64' ? '64 بیتی (x64)' : os.arch(), os.arch() === 'x64' ? '' : 'نسخه 64 بیتی Windows توصیه می‌شود.');
} else {
  add('windows-version', 'نسخه Windows', 'warn', 'قابل بررسی نیست (اجرای غیر Windows)', 'بررسی واقعی پس از نصب روی Windows انجام می‌شود.');
}

/* --------------------------------- node ---------------------------------- */

const nodeVersion = process.versions.node;
add(
  'node',
  'Node.js',
  compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0 ? 'ok' : 'fail',
  `نسخه ${nodeVersion} (حداقل ${MIN_NODE_VERSION})`,
  compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0 ? '' : `نصب Node.js نسخه ${MIN_NODE_VERSION} یا جدیدتر لازم است.`,
);

const npmVersion = commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']);
add('npm', 'npm', npmVersion ? 'ok' : 'fail', npmVersion ? `نسخه ${npmVersion}` : 'پیدا نشد', npmVersion ? '' : 'npm همراه Node.js نصب می‌شود؛ Node.js را دوباره نصب کنید.');

/* --------------------------------- disk ---------------------------------- */

const freeKb = freeSpaceKb(root);
const freeMb = freeKb === null ? null : Math.floor(freeKb / 1024);
const requiredMb = 3000;
add(
  'disk',
  'فضای آزاد دیسک',
  freeMb === null ? 'warn' : freeMb >= requiredMb ? 'ok' : 'fail',
  freeMb === null ? 'قابل محاسبه نیست' : `${freeMb} MB آزاد`,
  freeMb !== null && freeMb < requiredMb ? 'حداقل ۳ گیگابایت فضای آزاد لازم است (node_modules و build).' : '',
);

/* ----------------------------- write access ------------------------------ */

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.pishkan-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

const writableRoot = canWrite(root);
add(
  'write-access',
  'اجازه نوشتن در مسیر نصب',
  writableRoot ? 'ok' : 'fail',
  writableRoot ? root : `بدون دسترسی: ${root}`,
  writableRoot ? '' : 'پوشهٔ دیگری انتخاب کنید یا نصب‌کننده را با دسترسی Administrator اجرا کنید.',
);
const writableData = canWrite(dataDir(root));
add('write-data', 'اجازه نوشتن در پوشه داده', writableData ? 'ok' : 'fail', dataDir(root),
  writableData ? '' : 'پوشه داده باید قابل نوشتن باشد؛ مسیر نصب را تغییر دهید.');

/* -------------------------------- network -------------------------------- */

if (skipNetwork) {
  add('network', 'اتصال شبکه', 'warn', 'بررسی شبکه رد شد (--skip-network)', '');
} else {
  const started = Date.now();
  let networkOk = false;
  let detail = '';
  try {
    const response = await fetch('https://registry.npmjs.org/-/ping', { signal: AbortSignal.timeout(6000) });
    networkOk = response.ok;
    detail = `registry.npmjs.org · ${Date.now() - started} ms`;
  } catch (error) {
    detail = `اتصال برقرار نشد: ${error?.message ?? error}`;
  }
  add('network', 'اتصال شبکه', networkOk ? 'ok' : 'fail', detail,
    networkOk ? '' : 'اینترنت (یا دسترسی به registry.npmjs.org) برای دانلود وابستگی‌ها لازم است.');
}

/* ---------------------------------- port --------------------------------- */

const busy = await isPortBusy(port);
if (busy) {
  const fallback = await findFreePort(port + 1);
  add('port', 'پورت برنامه', 'warn', `پورت ${port} در حال استفاده است`,
    fallback ? `پورت آزاد پیشنهادی: ${fallback}` : 'پورت دیگری انتخاب کنید.');
} else {
  add('port', 'پورت برنامه', 'ok', `پورت ${port} آزاد است`);
}

/* --------------------------------- extras -------------------------------- */

const gitVersion = commandVersion('git', ['--version']);
add('git', 'Git (اختیاری)', gitVersion ? 'ok' : 'warn', gitVersion || 'نصب نیست',
  gitVersion ? '' : 'برای دریافت به‌روزرسانی از GitHub لازم است؛ نصب برنامه بدون آن ممکن است.');

if (process.platform === 'win32') {
  const psVersion = commandVersion('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']);
  add('powershell', 'PowerShell', psVersion ? 'ok' : 'warn', psVersion || 'پیدا نشد', '');
}

/* --------------------------------- report -------------------------------- */

const hasFailure = items.some((item) => item.status === 'fail');
const payload = {
  ok: !hasFailure,
  root,
  port,
  node: nodeVersion,
  npm: npmVersion || null,
  platform: process.platform,
  arch: os.arch(),
  envFile: envFilePath(root),
  freeMb,
  generatedAt: new Date().toISOString(),
  items,
  failures: items.filter((item) => item.status === 'fail').map((item) => item.title),
  warnings: items.filter((item) => item.status === 'warn').map((item) => item.title),
};

if (args.has('pretty')) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write(`RESULT_JSON:${JSON.stringify(payload)}\n`);
}
process.exit(hasFailure ? 1 : 0);
