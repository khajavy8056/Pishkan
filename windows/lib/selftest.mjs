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
import { readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

import {
  MODULE_DIR, compareVersions, envFilePath, findFreePort, formatBytes, isPortBusy, parseArgs, pidAlive, readJson, writeJson,
} from './common.mjs';
import { formatEnvValue, readEnvFile, renderEnvFile, restoreEnvFile, upsertEnvFile } from './envfile.mjs';
import { firewallRuleName, isPrivateLanIPv4, isSafeWindowsBindConfig, privateLanIPv4Addresses, privateLanUrls, resolveLanAccess } from './lan-access.mjs';
import { fixFile, lintAll, lintFile, parseAll } from './ps-lint.mjs';
import { runLanFirewall } from './lan-firewall.mjs';
import { formatManagerLogLine, sanitizeManagerLogMessage } from './manager-log.mjs';

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

test('گزارش مدیر خطاهای فنی را با حذف اسرار و داده هویتی ثبت می‌کند', () => {
  const sample = 'password="hunter2" Bearer abc.def token=secrettoken authority=AUTH-123 database_url=postgres://dbuser:dbpass@db.local/pishkan raw=redis://cache:cachepass@cache.local/0 callback_url=https://gateway.example.test/callback?paymentId=PAY-456 username=manager_admin full_name=AliceExample national=1234567890 mobile=09123456789 email=person@example.com path=/home/alice/Pishkan\nstack line';
  const safe = sanitizeManagerLogMessage(sample);
  for (const secret of ['hunter2', 'abc.def', 'secrettoken', 'AUTH-123', 'dbpass', 'cachepass', 'PAY-456', 'gateway.example.test', 'manager_admin', 'AliceExample', '1234567890', '09123456789', 'person@example.com', '/home/alice']) {
    assert.equal(safe.includes(secret), false, `مقدار حساس در گزارش مانده است: ${secret}`);
  }
  assert.equal(safe.includes('stack line'), true);
  assert.equal(safe.includes('\n'), false, 'پیام چندخطی باید به یک خط تبدیل شود');
  const line = formatManagerLogLine(sample, new Date('2026-10-31T12:00:00.000Z'));
  assert.match(line, /^\[2026-10-31T12:00:00\.000Z\] /);
  assert.ok(line.endsWith('\n'));
});

/* ------------------------- Windows script encoding ----------------------- */

test('همهٔ فایل‌های PowerShell دارای BOM و بدون مشکل ساختاری‌اند', () => {
  const results = lintAll();
  assert.ok(results.length >= 8, 'فایل‌های PowerShell پیدا نشدند');
  const broken = results.filter((result) => !result.ok);
  assert.deepEqual(
    broken.map((result) => `${result.file}: ${result.problems.join(' | ')}`),
    [],
    'فایل ویندوزی ناسالم وجود دارد',
  );
  const launchers = results.filter((result) => result.file.endsWith('.cmd'));
  assert.ok(launchers.length >= 4, 'لانچرهای .cmd پیدا نشدند');
});

test('نبود BOM در یک اسکریپت فارسی توسط بررسی‌کننده شناسایی می‌شود', () => {
  // Regression guard for the 2026-10-30 bug: PowerShell 5.1 read the BOM-less
  // script as ANSI, turned «—» into «”» and failed with "Unexpected token ')'".
  const file = path.join(tmp, 'bom-check.ps1');
  fs.writeFileSync(file, '# پیام فارسی — آزمون\nWrite-Host "سلام"\n', 'utf8');
  const broken = lintFile(file);
  assert.equal(broken.ok, false, 'نبود BOM تشخیص داده نشد');
  assert.ok(broken.problems.some((problem) => problem.includes('BOM')), 'پیام BOM داده نشد');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(file)]));
  assert.equal(lintFile(file).ok, true, 'پس از افزودن BOM باز هم خطا گزارش شد');
});

await testAsync('پارس واقعی PowerShell برای همهٔ اسکریپت‌های ویندوز', async () => {
  const parsed = await parseAll();
  if (!parsed.available) {
    // Never fake a pass: the check is recorded as skipped with the reason.
    skipped.push(`پارس PowerShell: ${parsed.reason}`);
    return;
  }
  const broken = parsed.results.filter((result) => !result.ok);
  assert.deepEqual(broken.map((result) => `${result.file}: ${result.problems.join(' | ')}`), []);
  assert.ok(parsed.results.length >= 6, 'تعداد اسکریپت‌های پارس‌شده کم است');
});

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

test('دسترسی LAN در نصب‌کننده فقط با انتخاب صریح فعال می‌شود و پیش‌فرض loopback است', () => {
  assert.deepEqual(resolveLanAccess(undefined, {}), { enabled: false, host: '127.0.0.1', value: 'false' });
  assert.deepEqual(resolveLanAccess(undefined, { LAN_ACCESS: 'true' }), { enabled: true, host: '0.0.0.0', value: 'true' });
  assert.deepEqual(resolveLanAccess(false, { LAN_ACCESS: 'true' }), { enabled: false, host: '127.0.0.1', value: 'false' });
  assert.deepEqual(resolveLanAccess(true, {}), { enabled: true, host: '0.0.0.0', value: 'true' });
  assert.equal(isSafeWindowsBindConfig('127.0.0.1', false), true);
  assert.equal(isSafeWindowsBindConfig('0.0.0.0', false), false);
  assert.equal(isSafeWindowsBindConfig('0.0.0.0', true), true);
  assert.equal(isSafeWindowsBindConfig('192.168.1.5', true), false);
});

test('آدرس‌های موبایل فقط IPv4 خصوصی را نمایش می‌دهند', () => {
  const interfaces = {
    wifi: [
      { address: '192.168.1.18', family: 'IPv4', internal: false },
      { address: '10.0.0.8', family: 4, internal: false },
      { address: '172.31.0.9', family: 'IPv4', internal: false },
      { address: '172.32.0.9', family: 'IPv4', internal: false },
      { address: '169.254.2.3', family: 'IPv4', internal: false },
      { address: '8.8.8.8', family: 'IPv4', internal: false },
      { address: '127.0.0.1', family: 'IPv4', internal: true },
      { address: 'fd00::1', family: 'IPv6', internal: false },
    ],
  };
  assert.equal(isPrivateLanIPv4('172.16.0.1'), true);
  assert.equal(isPrivateLanIPv4('172.32.0.1'), false);
  assert.deepEqual(privateLanIPv4Addresses(interfaces), ['10.0.0.8', '172.31.0.9', '192.168.1.18']);
  assert.deepEqual(privateLanUrls(3000, interfaces), [
    'http://10.0.0.8:3000', 'http://172.31.0.9:3000', 'http://192.168.1.18:3000',
  ]);
  assert.deepEqual(privateLanUrls(70000, interfaces), []);
});

test('اجرای مدیریت Firewall خارج از Windows بدون تغییر تنظیمات رد می‌شود', () => {
  if (process.platform === 'win32') {
    skipped.push('بررسی عدم اجرای PowerShell خارج از Windows: پلتفرم جاری Windows است.');
    return;
  }
  const result = runLanFirewall('ensure', { root: tmp, port: 3000, program: process.execPath });
  assert.equal(result.ok, false);
  assert.match(result.message, /فقط در نصب Windows/);
});

test('شناسه‌های قانون فایروال به نصب محدود و پایدارند', () => {
  const first = firewallRuleName(path.join(tmp, 'Pishkan'));
  assert.equal(first, firewallRuleName(path.join(tmp, 'Pishkan')));
  assert.notEqual(first, firewallRuleName(path.join(tmp, 'Other')));
  assert.match(first, /^PishkanLAN_[a-f0-9]{16}$/);
});

test('اسکریپت فایروال فقط Private/LocalSubnet را مجاز و Public/Domain را مسدود می‌کند', () => {
  const firewall = readFileSync(path.join(MODULE_DIR, 'lan-firewall.ps1'), 'utf8').replace(/^\uFEFF/, '');
  assert.match(firewall, /-Profile Private -Protocol TCP -LocalPort \$port -RemoteAddress LocalSubnet/);
  assert.match(firewall, /-Profile Public,Domain -Protocol TCP -LocalPort \$port -RemoteAddress Any/);
  assert.match(firewall, /DefaultInboundAction -ne 'Block'/);
  assert.match(firewall, /Find-BroadAllowRule/);
  assert.match(firewall, /function Test-ExactProfileSet/);
  assert.match(firewall, /Test-ExactProfileSet \$Rule\.Profile \$Profile/);
  assert.match(firewall, /function Test-ExactPort/);
  assert.match(firewall, /Test-ExactPort \$portFilter\.LocalPort \$Port/);
  assert.match(firewall, /function Test-ExactValueSet/);
  assert.match(firewall, /Test-ExactValueSet \$addressFilter\.RemoteAddress \$RemoteAddress/);
  assert.match(firewall, /Rule\.EdgeTraversalPolicy -ne 'Block'/);
  assert.match(firewall, /Test-RuleShape \$block 'Block' 'Public,Domain'/);
  assert.match(firewall, /-EdgeTraversalPolicy Block/);
  assert.doesNotMatch(firewall, /Set-NetFirewallProfile/);
});

test('ناظر LAN نحو JavaScript معتبر دارد', () => {
  const guard = spawnSync(process.execPath, ['--check', path.join(MODULE_DIR, 'lan-guard.mjs')], { encoding: 'utf8' });
  assert.equal(guard.status, 0, guard.stderr || guard.stdout);
});

test('installer, manager و API فقط پس از opt-in و تأیید Firewall به LAN bind می‌کنند', () => {
  const installer = readFileSync(path.join(MODULE_DIR, 'installer.mjs'), 'utf8');
  const manager = readFileSync(path.join(MODULE_DIR, 'manager.mjs'), 'utf8');
  const lanGuard = readFileSync(path.join(MODULE_DIR, 'lan-guard.mjs'), 'utf8');
  const apiGate = readFileSync(path.join(MODULE_DIR, '..', '..', 'apps', 'api', 'src', 'lib', 'server-bind.ts'), 'utf8');
  const apiEntry = readFileSync(path.join(MODULE_DIR, '..', '..', 'apps', 'api', 'src', 'index.ts'), 'utf8');
  assert.match(installer, /HOST: lan\.host/);
  assert.match(installer, /LAN_ACCESS: lan\.value/);
  assert.match(installer, /ZARINPAL_CALLBACK_BASE_URL/);
  assert.match(installer, /runLanFirewall\('ensure'/);
  assert.match(manager, /runLanFirewall\('ensure'/);
  assert.match(manager, /launchLanGuard/);
  assert.match(manager, /PISHKAN_LAN_FIREWALL_STATUS_FILE/);
  assert.match(manager, /PISHKAN_LAN_FIREWALL_TOKEN/);
  assert.match(manager, /PISHKAN_LAN_FIREWALL_VERIFIED: LAN_ACCESS \? 'true' : 'false'/);
  assert.match(lanGuard, /runLanFirewall\('status'/);
  assert.match(lanGuard, /writeLease\(false/);
  assert.match(lanGuard, /stopOwnedServer/);
  assert.match(apiGate, /isLanFirewallLeaseValid/);
  assert.match(apiEntry, /firewall lease expired; closing the LAN listener/);
  assert.match(manager, /mobileUrls/);
  assert.match(manager, /formatManagerLogLine/);
  assert.match(manager, /Unhandled manager failure/);
  assert.match(apiGate, /platform !== 'win32'\) return configuredHost/);
  assert.match(apiGate, /PISHKAN_LAN_FIREWALL_VERIFIED/);
});

await testAsync('installer dry-run persists opt-in LAN exactly and never touches Windows Firewall', async () => {
  for (const enabled of [false, true]) {
    const root = path.join(tmp, enabled ? 'installer-lan-on' : 'installer-lan-off');
    const result = spawnSync(process.execPath, [
      path.join(MODULE_DIR, 'installer.mjs'), '--root', root, '--dry-run', '--json-lines', '--job-stdin',
    ], {
      input: JSON.stringify({ port: enabled ? 45871 : 45872, lanAccess: enabled }),
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const settings = readEnvFile(envFilePath(root));
    assert.equal(settings.LAN_ACCESS, enabled ? 'true' : 'false');
    assert.equal(settings.HOST, enabled ? '0.0.0.0' : '127.0.0.1');
    assert.equal(settings.ZARINPAL_CALLBACK_BASE_URL, '');
  }
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

/* --------------------------- one-line JSON payloads ---------------------- */

test('لینتر ConvertTo-Json بدون -Compress را رد می‌کند', () => {
  const dir = path.join(tmp, 'lint-json');
  fs.mkdirSync(dir, { recursive: true });
  const bad = path.join(dir, 'bad.ps1');
  fs.writeFileSync(bad, '\uFEFF$job = @{ admin = $admin } | ConvertTo-Json -Depth 4\n');
  const result = lintFile(bad);
  assert.equal(result.ok, false, 'خروجی چندخطی JSON رد نشد');
  assert.ok(result.problems.some((p) => p.includes('-Compress')), result.problems.join(' | '));

  const good = path.join(dir, 'good.ps1');
  fs.writeFileSync(good, '\uFEFF$job = @{ admin = $admin } | ConvertTo-Json -Depth 4 -Compress\n');
  assert.equal(lintFile(good).ok, true, lintFile(good).problems.join(' | '));

  // The real installer must satisfy it too (the GUI sends this payload on stdin).
  const gui = readFileSync(path.join(MODULE_DIR, 'installer-gui.ps1'), 'utf8');
  assert.match(gui, /ConvertTo-Json[^\n]*-Compress/, 'پنجرهٔ نصب خروجی JSON را فشرده نمی‌کند');
});

await testAsync('نصب‌کننده JSON چندخطی PowerShell 5.1 را می‌پذیرد', async () => {
  const sandbox = path.join(tmp, 'pretty-job');
  fs.mkdirSync(sandbox, { recursive: true });
  writeJson(path.join(sandbox, 'package.json'), { name: 'pishkan-pretty', version: '0.0.0' });
  // Exactly what `ConvertTo-Json -Depth 4` (without -Compress) emits on PS 5.1.
  const pretty = [
    '{',
    '    "admin":  {',
    '                  "fullName":  "مدیر سامانه",',
    '                  "username":  "admin",',
    '                  "password":  "Pretty#Pass2026x"',
    '              }',
    '}',
  ].join('\r\n');
  const child = spawnSync(process.execPath, [
    path.join(MODULE_DIR, 'installer.mjs'), '--root', sandbox, '--port', '45612',
    '--json-lines', '--dry-run', '--no-start', '--job-stdin',
  ], { input: `${pretty}\r\n`, encoding: 'utf8' });
  const events = child.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const result = events.find((event) => event.type === 'result');
  assert.ok(result, 'رویداد نتیجه صادر نشد');
  assert.equal(result.ok, true, `نصب با JSON چندخطی شکست خورد: ${JSON.stringify(result.error)}`);
  assert.ok(!events.some((event) => event.level === 'error'), 'خطای JSON گزارش شد');
});

await testAsync('JSON خراب پیام روشن و نتیجهٔ ساخت‌یافته می‌دهد', async () => {
  const sandbox = path.join(tmp, 'bad-job');
  fs.mkdirSync(sandbox, { recursive: true });
  writeJson(path.join(sandbox, 'package.json'), { name: 'pishkan-bad', version: '0.0.0' });
  const child = spawnSync(process.execPath, [
    path.join(MODULE_DIR, 'installer.mjs'), '--root', sandbox, '--json-lines', '--dry-run', '--job-stdin',
  ], { input: 'this is not json\n', encoding: 'utf8' });
  assert.notEqual(child.status, 0, 'ورودی خراب باید کد خروج غیر صفر بدهد');
  const events = child.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const result = events.find((event) => event.type === 'result');
  assert.ok(result && result.ok === false, 'رویداد نتیجهٔ ناموفق صادر نشد');
  assert.match(result.error.message, /JSON/);
  // No Node stack trace in the machine-readable output.
  assert.ok(!child.stdout.includes('    at '), 'خروجی شامل ردپای استثناست');
});

test('--fix فایل .cmd با پایان خط LF را به CRLF برمی‌گرداند', () => {
  const dir = path.join(tmp, 'fix-eol');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'broken.cmd');
  fs.writeFileSync(file, '@echo off\ngoto end\n:end\n', 'latin1');
  const changes = fixFile(file);
  assert.ok(changes.length > 0, 'تغییری گزارش نشد');
  assert.equal(readFileSync(file, 'latin1'), '@echo off\r\ngoto end\r\n:end\r\n');
});

/* --------------------------- .NET compatibility --------------------------- */

test('لینتر انتساب StandardInputEncoding بدون گارد وجود را رد می‌کند', () => {
  const dir = path.join(tmp, 'lint-dotnet');
  fs.mkdirSync(dir, { recursive: true });
  const bad = path.join(dir, 'bad.ps1');
  fs.writeFileSync(
    bad,
    '\uFEFF$info = New-Object System.Diagnostics.ProcessStartInfo\n' +
    '$info.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false)\n',
  );
  const result = lintFile(bad);
  assert.equal(result.ok, false, 'انتساب بدون گارد رد نشد');
  assert.ok(
    result.problems.some((problem) => problem.includes('StandardInputEncoding')),
    `پیام مرتبط صادر نشد: ${result.problems.join(' | ')}`,
  );

  // The shipped windows must satisfy the very same rule.
  for (const script of ['installer-gui.ps1', 'manager-gui.ps1']) {
    const report = lintFile(path.join(MODULE_DIR, script));
    assert.ok(
      !report.problems.some((problem) => problem.includes('StandardInputEncoding')),
      `${script}: ${report.problems.join(' | ')}`,
    );
  }
});

/* ------------------------------ process helpers --------------------------- */

test('pidAlive فرایند زنده را درست تشخیص می‌دهد', () => {
  assert.equal(pidAlive(process.pid), true, 'فرایند جاری زنده تشخیص داده نشد');
  assert.equal(pidAlive(0), false);
  // A PID that is very unlikely to exist: the call must answer, not throw.
  assert.equal(typeof pidAlive(999999), 'boolean');
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

/* ----------------------- verify: root/env discovery ----------------------- */

await testAsync('verify پوشه و فایل تنظیمات را خودش پیدا می‌کند', async () => {
  const sandbox = path.join(tmp, 'discover');
  fs.mkdirSync(sandbox, { recursive: true });
  fs.writeFileSync(
    path.join(sandbox, '.env.windows.local'),
    renderEnvFile({
      NODE_ENV: 'development',
      DB_DRIVER: 'sqlite',
      SQLITE_FILE: path.join(sandbox, '.data', 'pishkan-windows.sqlite'),
      PORT: '45998',
      APP_ENCRYPTION_KEY: 'a'.repeat(64),
      UPLOAD_DIR: path.join(sandbox, '.data', 'uploads'),
      BACKUP_DIR: path.join(sandbox, '.data', 'backups'),
    }),
  );
  // No --env and no --root: the script must look inside its own directory
  // instead of reporting three fake failures about files it never opened.
  const child = spawnSync(process.execPath, [
    path.join(MODULE_DIR, 'verify.mjs'), '--mode', 'core', '--url', 'http://127.0.0.1:45998', '--root', sandbox,
  ], { encoding: 'utf8', cwd: tmp });
  const line = child.stdout.split('\n').find((row) => row.startsWith('RESULT_JSON:'));
  assert.ok(line, 'خروجی verify خوانده نشد');
  const report = JSON.parse(line.slice(12));
  const config = report.checks.find((item) => item.id === 'config');
  assert.equal(config.ok, true, `فایل تنظیمات پیدا نشد: ${config.detail}`);
  assert.match(config.detail, /sqlite/);
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

if (process.platform !== 'win32') {
  skipped.push('قانون واقعی Windows Defender Firewall و دسترسی موبایل روی Wi‑Fi: فقط روی Windows واقعی قابل اجراست.');
}

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
