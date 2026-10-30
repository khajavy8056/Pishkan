#!/usr/bin/env node
/**
 * Pishkan — console installer (fallback for the graphical installer).
 *
 *   node windows/lib/setup-console.mjs [--root <path>] [--port 3000]
 *
 * Used when the WinForms window cannot start (locked-down PowerShell, Server
 * Core, remote session without GUI) and by the automated tests, which pipe the
 * answers in. It collects the same information as the GUI and then runs the very
 * same engine (windows/lib/installer.mjs) with the same guarantees.
 *
 * Password input: when the terminal supports raw mode the password is read
 * without echo; otherwise the prompt says so explicitly.
 */
import { createInterface } from 'node:readline';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULT_PORT, DEFAULT_ROOT, compareVersions, MIN_NODE_VERSION, parseArgs } from './common.mjs';

const args = parseArgs();
const ROOT = path.resolve(args.get('root', DEFAULT_ROOT));

/**
 * One line queue for the whole session: a readline interface per question loses
 * buffered input when stdin is a pipe (the automated test does exactly that).
 */
const lines = createInterface({ input: process.stdin, terminal: false });
const pendingLines = [];
const lineWaiters = [];
lines.on('line', (line) => {
  if (lineWaiters.length) lineWaiters.shift()(line);
  else pendingLines.push(line);
});

function nextLine() {
  if (pendingLines.length) return Promise.resolve(pendingLines.shift());
  return new Promise((resolve) => lineWaiters.push(resolve));
}

async function ask(question, fallback = '') {
  process.stdout.write(question);
  const answer = (await nextLine()).trim();
  return answer || fallback;
}

async function askHidden(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question}(ورودی متنی است و نمایش داده می‌شود) `);
    return (await nextLine()).trim();
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      }
      if (char === '\u007f' || char === '\b') {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      value += char;
      process.stdout.write('*');
    };
    stdin.on('data', onData);
  });
}

function validate(username, password, confirm) {
  if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) return 'نام کاربری باید ۳ تا ۶۰ کاراکتر و شامل حروف انگلیسی، رقم، نقطه، زیرخط یا خط تیره باشد.';
  if (password.length < 10) return 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.';
  if (!/[A-Za-z\u0600-\u06FF]/.test(password) || !/\d/.test(password)) return 'رمز عبور باید ترکیبی از حرف و رقم باشد.';
  if (password !== confirm) return 'رمز عبور و تکرار آن یکسان نیستند.';
  return '';
}

async function main() {
  process.stdout.write('\n=== نصب Pishkan روی ویندوز (حالت متنی) ===\n');
  process.stdout.write(`نسخه Node.js: ${process.versions.node}\n`);
  if (compareVersions(process.versions.node, MIN_NODE_VERSION) < 0) {
    process.stdout.write(`Node.js باید ${MIN_NODE_VERSION} یا جدیدتر باشد.\n`);
    process.exit(1);
  }

  const root = path.resolve(await ask(`مسیر نصب [${ROOT}]: `, ROOT));
  const portAnswer = await ask(`پورت برنامه [${DEFAULT_PORT}]: `, String(DEFAULT_PORT));
  const port = Number.parseInt(portAnswer, 10) || DEFAULT_PORT;

  let admin = null;
  for (;;) {
    const fullName = await ask('نام و نام خانوادگی مدیر کل [مدیر کل محلی]: ', 'مدیر کل محلی');
    const username = await ask('نام کاربری مدیر کل [admin]: ', 'admin');
    const password = await askHidden('رمز عبور مدیر کل (حداقل ۱۰ کاراکتر، حرف و رقم): ');
    const confirm = await askHidden('تکرار رمز عبور: ');
    const problem = validate(username, password, confirm);
    if (problem) {
      process.stdout.write(`✗ ${problem}\n\n`);
      continue;
    }
    admin = { fullName, username, password };
    break;
  }

  process.stdout.write('\nشروع نصب…\n');
  const child = spawn(process.execPath, [
    path.join(path.dirname(new URL(import.meta.url).pathname), 'installer.mjs'),
    '--root', root, '--json-lines', '--job-stdin',
  ], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });

  child.stdin.end(`${JSON.stringify({ port, admin })}\n`);

  let lastKey = '';
  let ok = false;
  const reader = createInterface({ input: child.stdout });
  for await (const line of reader) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      process.stdout.write(`${line}\n`);
      continue;
    }
    if (event.type === 'step') {
      const key = `${event.id}:${event.status}:${event.message}`;
      if (key === lastKey) continue;
      lastKey = key;
      const mark = event.status === 'ok' ? '✓' : event.status === 'fail' ? '✗' : event.status === 'skip' ? '–' : '…';
      process.stdout.write(`  [${String(event.progress).padStart(3)}%] ${mark} ${event.title}${event.message ? ` — ${event.message}` : ''}\n`);
    } else if (event.type === 'log') {
      process.stdout.write(`         ${event.message}\n`);
    } else if (event.type === 'retry') {
      process.stdout.write(`         تلاش دوباره ${event.attempt}/${event.attempts}…\n`);
    } else if (event.type === 'result') {
      ok = Boolean(event.ok);
      if (event.ok) {
        process.stdout.write(`\nنصب کامل شد. آدرس: ${event.report.url}\n`);
        process.stdout.write(`گزارش نصب: ${path.join(root, '.data', 'install-report.json')}\n`);
      } else {
        process.stdout.write(`\nنصب ناموفق بود: ${event.error?.message ?? ''}\n`);
        process.stdout.write(`گزارش خطا: ${path.join(root, '.data', 'install-error.json')}\n`);
      }
    }
  }
  const code = await new Promise((resolve) => child.on('close', resolve));
  process.exit(ok && code === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`خطای نصب‌کننده: ${error?.message ?? error}\n`);
  process.exit(2);
});
