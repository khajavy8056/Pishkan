#!/usr/bin/env node
/**
 * Automated tests for the Windows installer/manager *logic*.
 *
 * These tests run on any platform (they are executed on Linux in CI and in the
 * sandbox) because windows/lib/*.mjs contains no Windows-only code. The
 * PowerShell GUI layer cannot be tested here and is therefore reported as
 * "not executed" — see docs/WINDOWS-LOCAL-TEST-REPORT-2026-10-30.md.
 *
 *   node windows/lib/selftest.mjs [--verbose]
 *
 * Exit code 0 = every executed test passed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

import {
  MODULE_DIR, compareVersions, findFreePort, formatBytes, isPortBusy, parseArgs, readJson, writeJson,
} from './common.mjs';
import { formatEnvValue, readEnvFile, renderEnvFile, restoreEnvFile, upsertEnvFile } from './envfile.mjs';

const args = parseArgs();
const verbose = args.has('verbose');
const results = [];
const skipped = [];

function test(name, fn) {
  try {
    const value = fn();
    results.push({ name, ok: true });
    if (verbose) process.stdout.write(`✓ ${name}\n`);
    return value;
  } catch (error) {
    results.push({ name, ok: false, error: error?.message ?? String(error) });
    process.stdout.write(`✗ ${name} — ${error?.message ?? error}\n`);
    return undefined;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    if (verbose) process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    results.push({ name, ok: false, error: error?.message ?? String(error) });
    process.stdout.write(`✗ ${name} — ${error?.message ?? error}\n`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-selftest-'));

/* ------------------------------- env file -------------------------------- */

test('مقدار شامل # در فایل تنظیمات سالم می‌ماند', () => {
  const file = path.join(tmp, 'a.env');
  upsertEnvFile(file, { BOOTSTRAP_ADMIN_PASSWORD: 'WinTest#Pass123', PORT: '3000' });
  const values = readEnvFile(file);
  assert.equal(values.BOOTSTRAP_ADMIN_PASSWORD, 'WinTest#Pass123');
  assert.equal(values.PORT, '3000');
});

test('مسیر ویندوزی با فاصله در فایل تنظیمات سالم می‌ماند', () => {
  const file = path.join(tmp, 'b.env');
  upsertEnvFile(file, { UPLOAD_DIR: 'C:\\Program Files\\Pishkan\\data\\uploads' });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /UPLOAD_DIR="C:\\Program Files\\Pishkan\\data\\uploads"/);
  assert.equal(readEnvFile(file).UPLOAD_DIR, 'C:\\Program Files\\Pishkan\\data\\uploads');
});

test('مقدار شامل گیومه رد می‌شود (dotenv نمی‌تواند آن را برگرداند)', () => {
  assert.throws(() => formatEnvValue('bad"value'), /غیرمجاز/);
  assert.throws(() => formatEnvValue("bad'value"), /غیرمجاز/);
  assert.throws(() => formatEnvValue('bad\nvalue'), /غیرمجاز/);
});

test('نوشتن تنظیمات، مقادیر موجود را حفظ و کلیدهای تکراری را به‌روزرسانی می‌کند', () => {
  const file = path.join(tmp, 'c.env');
  upsertEnvFile(file, { PORT: '3000', APP_ENCRYPTION_KEY: 'k1' }, { header: ['# سرآغاز'] });
  upsertEnvFile(file, { PORT: '3100', NEW_KEY: 'x' });
  const values = readEnvFile(file);
  assert.equal(values.PORT, '3100');
  assert.equal(values.APP_ENCRYPTION_KEY, 'k1');
  assert.equal(values.NEW_KEY, 'x');
  assert.match(fs.readFileSync(file, 'utf8'), /^# سرآغاز/);
  const backups = fs.readdirSync(tmp).filter((name) => name.startsWith('c.env.bak-'));
  assert.ok(backups.length >= 1, 'نسخه پشتیبان ساخته نشد');
});

test('بازگردانی نسخه پشتیبان تنظیمات', () => {
  const file = path.join(tmp, 'd.env');
  upsertEnvFile(file, { PORT: '3000' });
  upsertEnvFile(file, { PORT: '3100' }); // the second write creates the backup
  fs.writeFileSync(file, 'BROKEN=1\n');
  assert.equal(restoreEnvFile(file), true);
  assert.equal(readEnvFile(file).PORT, '3000');
});

test('renderEnvFile همه مقادیر را نقل‌قول می‌کند', () => {
  const text = renderEnvFile({ A: '1', B: 'x y' });
  assert.equal(text, 'A="1"\nB="x y"\n');
});

test('کلید تنظیمات نامعتبر رد می‌شود', () => {
  assert.throws(() => renderEnvFile({ 'bad key': '1' }), /نامعتبر/);
});

/* -------------------------------- helpers -------------------------------- */

test('مقایسه نسخه Node', () => {
  assert.equal(compareVersions('22.22.3', '22.22.2'), 1);
  assert.equal(compareVersions('22.22.2', '22.22.2'), 0);
  assert.equal(compareVersions('22.9.0', '22.22.2'), -1);
  assert.equal(compareVersions('v20.11.1', '22.22.2'), -1);
});

test('قالب‌بندی حجم', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('نوشتن و خواندن JSON اتمیک', () => {
  const file = path.join(tmp, 'state.json');
  writeJson(file, { pid: 42 });
  assert.deepEqual(readJson(file), { pid: 42 });
  fs.writeFileSync(file, '{ not json');
  assert.equal(readJson(file, 'fallback'), 'fallback');
});

test('parseArgs پرچم و مقدار را جدا می‌کند', () => {
  const parsed = parseArgs(['--root', '/tmp/x', '--json', '--lines', '20']);
  assert.equal(parsed.get('root'), '/tmp/x');
  assert.equal(parsed.get('lines'), '20');
  assert.equal(parsed.has('json'), true);
  assert.equal(parsed.has('root'), false);
});

await testAsync('تشخیص پورت آزاد و اشغال‌شده', async () => {
  const port = await findFreePort(45100);
  assert.ok(port >= 45100, 'پورت آزاد پیدا نشد');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    assert.equal(await isPortBusy(port), true);
    const next = await findFreePort(port);
    assert.notEqual(next, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------- syscheck -------------------------------- */

await testAsync('syscheck گزارش JSON ساخت‌یافته می‌دهد', async () => {
  const result = spawnSync(process.execPath, [path.join(MODULE_DIR, 'syscheck.mjs'), '--root', tmp, '--port', '45999', '--skip-network'], {
    encoding: 'utf8',
  });
  const line = result.stdout.split('\n').find((row) => row.startsWith('RESULT_JSON:'));
  assert.ok(line, 'خروجی syscheck خوانده نشد');
  const report = JSON.parse(line.slice(12));
  assert.ok(Array.isArray(report.items) && report.items.length >= 8, 'تعداد بررسی‌ها کم است');
  const ids = report.items.map((item) => item.id);
  for (const required of ['platform', 'node', 'npm', 'disk', 'write-access', 'network', 'port']) {
    assert.ok(ids.includes(required), `بررسی ${required} وجود ندارد`);
  }
  assert.equal(report.items.find((item) => item.id === 'node').status, 'ok');
});

/* ------------------------- installer: dry-run wiring ---------------------- */

await testAsync('installer در حالت dry-run بدون تغییر چیزی گزارش کامل می‌دهد', async () => {
  const sandbox = path.join(tmp, 'dry');
  fs.mkdirSync(sandbox, { recursive: true });
  // A minimal project skeleton: the installer only requires package.json to exist
  // for the dependency step, which is skipped in dry-run.
  writeJson(path.join(sandbox, 'package.json'), { name: 'pishkan-dry', version: '0.0.0' });
  const child = spawnSync(process.execPath, [
    path.join(MODULE_DIR, 'installer.mjs'), '--root', sandbox, '--port', '45551', '--json-lines', '--dry-run', '--no-start',
  ], { input: `${JSON.stringify({ admin: { username: 'admin', password: 'DryRun#12345', fullName: 'مدیر آزمون' } })}\n`, encoding: 'utf8' });
  const events = child.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const result = events.find((event) => event.type === 'result');
  assert.ok(result, 'رویداد نتیجه صادر نشد');
  assert.equal(result.ok, true, `dry-run شکست خورد: ${JSON.stringify(result.error)}`);
  const env = readEnvFile(path.join(sandbox, '.env.windows.local'));
  assert.equal(env.PORT, '45551');
  assert.equal(env.DB_DRIVER, 'sqlite');
  assert.ok((env.APP_ENCRYPTION_KEY || '').length >= 32, 'کلید رمزنگاری ساخته نشد');
  const steps = events.filter((event) => event.type === 'step' && event.status !== 'running').map((event) => `${event.id}:${event.status}`);
  assert.ok(steps.includes('deps:skip'), 'گام وابستگی‌ها اجرا شد');
  assert.ok(steps.includes('verify:skip'), 'گام بررسی نهایی گزارش نشد');
});

/* --------------------------- manager safeguards --------------------------- */

await testAsync('مدیر پروژه‌ای را که سرویس ندارد با پیام روشن گزارش می‌کند', async () => {
  const sandbox = path.join(tmp, 'empty');
  fs.mkdirSync(sandbox, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(MODULE_DIR, 'manager.mjs'), 'start', '--root', sandbox, '--json'], { encoding: 'utf8' });
  const line = result.stdout.split('\n').find((row) => row.startsWith('RESULT_JSON:'));
  assert.ok(line, 'خروجی مدیر خوانده نشد');
  const payload = JSON.parse(line.slice(12));
  assert.equal(payload.ok, false);
  assert.match(payload.message, /تنظیمات|ساخت/);
});

await testAsync('مدیر پاسخ 200 یک برنامه دیگر را «Pishkan در حال اجرا» حساب نمی‌کند', async () => {
  const sandbox = path.join(tmp, 'foreign');
  fs.mkdirSync(sandbox, { recursive: true });
  const port = await findFreePort(45600);
  upsertEnvFile(path.join(sandbox, '.env.windows.local'), { PORT: String(port), SQLITE_FILE: path.join(sandbox, 'db.sqlite') });
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('not pishkan');
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    const result = spawnSync(process.execPath, [path.join(MODULE_DIR, 'manager.mjs'), 'start', '--root', sandbox, '--json'], { encoding: 'utf8' });
    const line = result.stdout.split('\n').find((row) => row.startsWith('RESULT_JSON:'));
    const payload = JSON.parse(line.slice(12));
    assert.equal(payload.ok, false, 'برنامه بیگانه به‌عنوان سرویس Pishkan شناسایی شد');
    assert.match(payload.message, /اشغال/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await testAsync('پشتیبان‌گیری بدون پایگاه داده با پیام روشن رد می‌شود', async () => {
  const sandbox = path.join(tmp, 'nobackup');
  fs.mkdirSync(sandbox, { recursive: true });
  upsertEnvFile(path.join(sandbox, '.env.windows.local'), { PORT: '45700', SQLITE_FILE: path.join(sandbox, 'missing.sqlite') });
  const result = spawnSync(process.execPath, [path.join(MODULE_DIR, 'manager.mjs'), 'backup', '--root', sandbox, '--json'], { encoding: 'utf8' });
  const payload = JSON.parse(result.stdout.split('\n').find((row) => row.startsWith('RESULT_JSON:')).slice(12));
  assert.equal(payload.ok, false);
  assert.match(payload.message, /پیدا نشد/);
});

/* -------------------------------- reporting ------------------------------ */

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((result) => !result.ok);
const payload = {
  ok: failed.length === 0,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.map((result) => `${result.name}: ${result.error}`),
  skipped,
  platform: process.platform,
  node: process.versions.node,
  executedAt: new Date().toISOString(),
};
process.stdout.write(`RESULT_JSON:${JSON.stringify(payload)}\n`);
process.stdout.write(`\n${payload.passed}/${payload.total} آزمون کتابخانه ویندوز موفق بود.\n`);
process.exit(payload.ok ? 0 : 1);
