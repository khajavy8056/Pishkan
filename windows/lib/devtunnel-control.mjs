/**
 * The verb layer: everything that actually touches `devtunnel.exe`.
 *
 * Separated from `devtunnel.mjs` (pure parsing/config) so that file stays
 * testable without a CLI, and this one can be driven end-to-end from the
 * manager. Both the installer's tunnel step and the manager's on/off button
 * call the same functions, which is why they cannot drift apart.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import {
  downloadUrl,
  pidLikelyAlive,
  readTail,
  readTunnelState,
  sanitizeTunnelState,
  startTunnelProcess,
  tunnelBinPath,
  tunnelLogPath,
  tunnelName,
  tunnelStatePath,
  waitForTunnelUrl,
  writeTunnelState,
  parseHostUrl,
  inspectUrlFor,
} from './devtunnel.mjs';

/** Run the CLI synchronously and normalise the result. */
export function runDevTunnel(root, args, { timeoutMs = 120_000, input } = {}) {
  const bin = tunnelBinPath(root);
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    input,
    windowsHide: true,
    env: { ...process.env, DEV_TUNNEL_NO_TELEMETRY: '1' },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(),
    error: result.error?.message ?? '',
  };
}

export function tunnelBinaryPresent(root) {
  return fs.existsSync(tunnelBinPath(root));
}

export function tunnelVersion(root) {
  if (!tunnelBinaryPresent(root)) return '';
  const result = runDevTunnel(root, ['--version'], { timeoutMs: 20_000 });
  return result.ok ? result.output.split('\n')[0].trim() : '';
}

/**
 * Download the CLI if it is not already usable.
 *
 * On Windows this shells out to `tunnel-download.ps1` (see that file for why
 * PowerShell and not Node). Off Windows it reports "unsupported" so the
 * installer can explain that this feature is a Windows-install feature rather
 * than pretending to succeed.
 */
export function ensureDevTunnelCli(root, { log = () => {} } = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'unsupported-platform', message: 'این قابلیت فقط در نصب ویندوز پشتیبانی می‌شود.' };
  }
  const existing = tunnelVersion(root);
  if (existing) {
    log(`devtunnel از قبل نصب است: ${existing}`);
    return { ok: true, alreadyInstalled: true, version: existing, path: tunnelBinPath(root) };
  }

  const script = path.join(root, 'windows', 'lib', 'tunnel-download.ps1');
  if (!fs.existsSync(script)) {
    return { ok: false, reason: 'script-missing', message: 'فایل دانلود ابزار تونل در بستهٔ نصب پیدا نشد.' };
  }
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  log('دانلود Microsoft Dev Tunnels CLI…');
  const result = spawnSync(powershell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Target', tunnelBinPath(root),
    '-LogFile', tunnelLogPath(root),
  ], { encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true });

  const line = (result.stdout ?? '').split('\n').reverse().find((entry) => entry.trim().startsWith('{'));
  let payload = null;
  try { payload = line ? JSON.parse(line) : null; } catch { payload = null; }
  if (payload?.ok) {
    const version = tunnelVersion(root);
    log(`devtunnel نصب شد: ${version || payload.version} (منبع: ${payload.source || '—'})`);
    return { ok: true, version: version || payload.version, source: payload.source, path: tunnelBinPath(root) };
  }
  const message = payload?.message || (result.stderr ?? '').trim() || 'دانلود ابزار تونل ناموفق بود.';
  log(`دانلود devtunnel ناموفق: ${message}`);
  return {
    ok: false,
    reason: 'download-failed',
    message,
    downloadUrl: downloadUrl(),
    // The installer turns this into an actionable sentence rather than a stack trace.
    hints: [
      'هر سه مسیر امتحان شد: aka.ms، نصب با winget، و فایل دستی.',
      'فایل devtunnel.exe را روی رایانهٔ دیگری از aka.ms/TunnelsCliDownload/win-x64 بگیرید و با نام devtunnel.exe.download در پوشهٔ windows\\bin همین نصب بگذارید؛ نصب‌کننده آن را بررسی و جای‌گذاری می‌کند.',
      'این گزینه را خاموش بگذارید تا نصب ادامه یابد؛ بعداً از Pishkan Manager دکمهٔ «لینک عمومی / تونل» همان کار را انجام می‌دهد و بقیهٔ نصب تحت تأثیر نیست.',
    ],
  };
}

/**
 * Run the CLI while streaming its output line by line.
 *
 * Sign-in is the one place where this matters: the device-code flow prints a
 * code and then waits for the operator to type it, so capturing the output and
 * showing it afterwards would show the code after it had already expired. The
 * same applies to the browser flow's "waiting for sign-in" messages, which tell
 * the operator what the installer is actually doing.
 */
export function runDevTunnelStreaming(root, args, { onLine = () => {}, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const bin = tunnelBinPath(root);
    const child = spawn(bin, args, { cwd: root, windowsHide: true });
    let buffer = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ ok: false, timedOut: true, output: buffer, message: 'زمان ورود به پایان رسید.' });
    }, timeoutMs);
    const consume = (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) { if (line.trim()) onLine(line.trim()); }
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    child.on('error', (error) => finish({ ok: false, output: buffer, message: error.message }));
    child.on('close', (code) => {
      if (buffer.trim()) onLine(buffer.trim());
      finish({ ok: code === 0, status: code, output: buffer });
    });
  });
}

/** Is the CLI logged in? Never prints the token — only the account line. */
export function loginStatus(root) {
  const result = runDevTunnel(root, ['user', 'show'], { timeoutMs: 30_000 });
  if (!result.ok) {
    return { loggedIn: false, account: '', message: result.output || 'وضعیت ورود مشخص نیست.' };
  }
  // The CLI prints the signed-in account among other lines. Take the line that
  // looks like an identity rather than parsing a fixed offset of a preview CLI.
  const lines = result.output.split('\n').map((line) => line.trim()).filter(Boolean);
  const account = lines.find((line) => /@/.test(line) && !/https?:/i.test(line)) ?? '';
  // "Not logged in" is reported as a non-zero exit in some builds and as text
  // in others; treat an empty account with an explicit message as logged out.
  const loggedOut = /not\s+logged|sign\s*in|login/i.test(result.output) && !account;
  return { loggedIn: Boolean(account) && !loggedOut, account, message: result.output };
}

/**
 * Interactive login. The CLI opens the default browser on a Microsoft/Entra/
 * GitHub page; the process then blocks until the browser round-trip finishes.
 *
 * This is intentionally synchronous and intentionally blocking: the installer
 * shows a modal "waiting for sign-in" state and the operator completes it in
 * the browser. There is no way to skip it — hosting a tunnel requires an
 * identity, and Microsoft's service will not issue a host connection without
 * one.
 */
export async function loginInteractive(root, { log = () => {}, timeoutMs = 10 * 60_000 } = {}) {
  log('در حال باز کردن صفحهٔ ورود مایکروسافت/گیت‌هاب در مرورگر… اگر باز نشد، آدرس چاپ‌شده را دستی باز کنید.');
  // Streamed rather than captured: the CLI prints the URL it is waiting on and
  // periodic "waiting" lines, which is the only feedback the operator gets
  // while a browser round-trip is in flight.
  const result = await runDevTunnelStreaming(root, ['user', 'login'], {
    timeoutMs,
    onLine: (line) => log(line),
  });
  const status = loginStatus(root);
  if (status.loggedIn) {
    log(`ورود انجام شد: ${status.account}`);
    return { ok: true, account: status.account };
  }
  return {
    ok: false,
    message: result.timedOut
      ? 'زمان ورود (۱۰ دقیقه) تمام شد. دوباره تلاش کنید یا از روش «کد دستگاه» استفاده کنید.'
      : (result.output?.trim() || 'ورود به حساب مایکروسافت/گیت‌هاب ناموفق بود.'),
    account: status.account,
    output: result.output ?? '',
  };
}

/**
 * Device-code login: the CLI prints a short code and a URL, then waits.
 *
 * This exists for a locked-down Windows session where the default browser
 * cannot be started — the code can be typed on a phone instead. The code must
 * reach the operator while the process is still waiting, hence streaming.
 */
export async function loginDeviceCode(root, { log = () => {}, timeoutMs = 10 * 60_000 } = {}) {
  log('ورود با کد دستگاه…');
  const result = await runDevTunnelStreaming(root, ['user', 'login', '-d'], {
    timeoutMs,
    onLine: (line) => log(line),
  });
  const status = loginStatus(root);
  if (status.loggedIn) return { ok: true, account: status.account, output: result.output };
  return {
    ok: false,
    message: result.timedOut
      ? 'زمان ورود با کد دستگاه تمام شد.'
      : (result.output?.trim() || 'ورود با کد دستگاه ناموفق بود.'),
    output: result.output ?? '',
  };
}

/**
 * Create the tunnel if needed, add the port, and make it anonymous.
 *
 * Anonymous is not optional here: the customer opens the link in a browser
 * (which skips Microsoft's sign-in because the tunnel allows anonymous
 * connect) and the Android app has no way to attach an X-Tunnel-Authorization
 * header. The protection is Pishkan's own login screen, which the tunnel does
 * not touch.
 */
export function ensureTunnel(root, { port, log = () => {} }) {
  // Tunnel ids are unique per Microsoft account, not per machine: a hash of the
  // install path can collide for two customers who both installed to
  // `C:\Pishkan`. The collision is only detectable at create time, so it is
  // handled there rather than by making ids longer and uglier.
  let name = tunnelName(root, crypto);

  const shown = runDevTunnel(root, ['show', name], { timeoutMs: 40_000 });
  const exists = shown.ok && /Tunnel ID/i.test(shown.output);

  if (!exists) {
    log(`ساخت تونل «${name}»…`);
    // 30d is the service maximum; the manager re-runs this on every start, so
    // an expired tunnel is recreated rather than silently dead.
    let created = runDevTunnel(root, ['create', name, '--allow-anonymous', '--expiration', '30d'], { timeoutMs: 60_000 });
    if (!created.ok && /exist|already|conflict|taken/i.test(created.output)) {
      const suffix = crypto.randomBytes(3).toString('hex');
      name = `${name}-${suffix}`;
      log(`نام تونل قبلاً استفاده شده بود؛ تلاش با «${name}»…`);
      created = runDevTunnel(root, ['create', name, '--allow-anonymous', '--expiration', '30d'], { timeoutMs: 60_000 });
    }
    if (!created.ok) {
      return { ok: false, step: 'create', message: created.output || 'ساخت تونل ناموفق بود.' };
    }
  } else {
    // Re-arm the expiry and the access entry: a tunnel created 29 days ago and
    // left alone would otherwise disappear mid-demo.
    runDevTunnel(root, ['update', name, '--expiration', '30d'], { timeoutMs: 40_000 });
    runDevTunnel(root, ['access', 'create', name, '--anonymous'], { timeoutMs: 40_000 });
  }

  // A port entry is idempotent in practice, but on a recreated tunnel it is
  // missing, and `port create` on an existing one exits non-zero. Both are fine.
  const ports = runDevTunnel(root, ['port', 'list', name], { timeoutMs: 40_000 });
  const hasPort = new RegExp(`\\b${port}\\b`).test(ports.output);
  if (!hasPort) {
    log(`افزودن پورت ${port} به تونل…`);
    const added = runDevTunnel(root, ['port', 'create', name, '-p', String(port), '--protocol', 'http'], { timeoutMs: 60_000 });
    if (!added.ok && !/already|exists/i.test(added.output)) {
      return { ok: false, step: 'port', message: added.output || 'افزودن پورت به تونل ناموفق بود.' };
    }
  }
  return { ok: true, tunnelName: name };
}

/**
 * Start hosting. Returns once the public URL has appeared in the log.
 *
 * If a host process from a previous run is still alive, it is adopted instead
 * of starting a second one: two `devtunnel host` processes on one tunnel is
 * the documented cause of intermittent 502s.
 */
export async function startHosting(root, { port, log = () => {} } = {}) {
  const name = tunnelName(root, crypto);
  const logFile = tunnelLogPath(root);
  const previous = readTunnelState(root);

  if (previous?.pid && pidLikelyAlive(previous.pid) && previous.publicUrl) {
    log('تونل از قبل در حال اجراست؛ همان لینک استفاده می‌شود.');
    return {
      ok: true,
      alreadyRunning: true,
      publicUrl: previous.publicUrl,
      pid: previous.pid,
      account: previous.account ?? '',
      tunnelName: name,
    };
  }

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  // Mark the boundary so a stale URL from an earlier session is never mistaken
  // for this one's.
  fs.appendFileSync(logFile, `\n--- start ${new Date().toISOString()} ---\n`, 'utf8');

  const pid = startTunnelProcess({ spawn, binPath: tunnelBinPath(root), name, root, logFile });
  const publicUrl = await waitForTunnelUrl(logFile, { timeoutMs: 60_000 });
  const status = loginStatus(root);

  if (!publicUrl) {
    const tail = readTail(logFile, 8_000);
    writeTunnelState(root, sanitizeTunnelState({
      ok: false, tunnelName: name, pid, account: status.account, message: tail.slice(-600),
    }));
    return {
      ok: false,
      step: 'host',
      pid,
      // The two failure modes seen in the wild, named so the UI can say
      // something better than "failed".
      message: /login|sign\s*in|401|unauthor/i.test(tail)
        ? 'توکن ورود منقضی شده است؛ دوباره وارد شوید.'
        : 'پورت در تونل بالا نیامد. اگر تازه نصب کرده‌اید، یک بار دیگر تلاش کنید.',
      output: tail.slice(-1500),
    };
  }

  writeTunnelState(root, sanitizeTunnelState({
    ok: true,
    tunnelName: name,
    publicUrl,
    port,
    pid,
    startedAt: new Date().toISOString(),
    account: status.account,
    message: 'تونل فعال است.',
  }));

  return { ok: true, publicUrl, pid, account: status.account, tunnelName: name, inspectUrl: inspectUrlFor(publicUrl) };
}

/**
 * Stop hosting. Asks the CLI first (clean relay shutdown), then falls back to
 * killing our recorded pid.
 */
export function stopHosting(root, { log = () => {} } = {}) {
  const name = tunnelName(root, crypto);
  const previous = readTunnelState(root);
  const killed = [];
  if (previous?.pid && pidLikelyAlive(previous.pid)) {
    try { process.kill(previous.pid); killed.push(previous.pid); } catch { /* already gone */ }
  }
  // A host process started by an older manager build may not be in our state.
  if (process.platform === 'win32') {
    const taskkill = spawnSync('taskkill', ['/F', '/IM', 'devtunnel.exe'], { encoding: 'utf8', windowsHide: true });
    if (taskkill.status === 0) killed.push('devtunnel.exe');
  }
  log(`تونل متوقف شد (${killed.length ? killed.join(', ') : 'پروسه‌ای در حال اجرا نبود'}).`);
  writeTunnelState(root, sanitizeTunnelState({ ok: false, tunnelName: name, message: 'تونل خاموش است.' }));
  return { ok: true, stopped: killed, message: 'تونل خاموش شد.' };
}

/** Public URL as the CLI currently sees it, without starting anything. */
export function currentPublicUrl(root) {
  const state = readTunnelState(root);
  if (!state?.publicUrl) return '';
  return state.publicUrl;
}

/**
 * Full status for the manager's status payload: does not start or stop
 * anything, only reports.
 */
export function tunnelStatus(root) {
  const state = readTunnelState(root);
  const present = tunnelBinaryPresent(root);
  const version = present ? tunnelVersion(root) : '';
  const running = Boolean(state?.pid) && pidLikelyAlive(state.pid);
  const login = present ? loginStatus(root) : { loggedIn: false, account: '', message: '' };
  return {
    supported: process.platform === 'win32',
    installed: present,
    version,
    loggedIn: Boolean(login.loggedIn),
    account: login.account || state?.account || '',
    running,
    publicUrl: running ? (state?.publicUrl ?? '') : '',
    lastKnownUrl: state?.publicUrl ?? '',
    tunnelName: state?.tunnelName || tunnelName(root, crypto),
    pid: running ? state.pid : null,
    stateFile: tunnelStatePath(root),
    logFile: tunnelLogPath(root),
    message: !present
      ? 'ابزار Microsoft Dev Tunnels نصب نشده است.'
      : !login.loggedIn
        ? 'وارد حساب مایکروسافت/گیت‌هاب نشده‌اید.'
        : running
          ? 'تونل فعال است.'
          : 'تونل خاموش است.',
  };
}

/** Same URL with the `-inspect` host, for the operator to watch traffic. */
export { inspectUrlFor };
