import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { firewallRuleName } from './lan-access.mjs';

const SCRIPT = fileURLToPath(new URL('./lan-firewall.ps1', import.meta.url));

function powershellPath() {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  if (windowsRoot) {
    const bundled = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(bundled)) return bundled;
  }
  return 'powershell.exe';
}

/**
 * Apply or inspect this install's narrowly scoped Windows Firewall rules.
 * Creating/removing a rule never triggers UAC implicitly: a new rule requires
 * the installer/manager to already be elevated; an existing valid rule can be
 * checked and used by a standard user.
 */
export function runLanFirewall(action, { root, port, program = process.execPath, timeoutMs = 60_000 } = {}) {
  if (!['ensure', 'remove', 'status'].includes(action)) {
    return { ok: false, message: 'درخواست مدیریت فایروال معتبر نیست.' };
  }
  if (process.platform !== 'win32') {
    return { ok: false, message: 'مدیریت فایروال LAN فقط در نصب Windows انجام می‌شود.' };
  }
  const requestedPort = Number(port);
  const validPort = Number.isInteger(requestedPort) && requestedPort >= 1024 && requestedPort <= 65535;
  if (!validPort && action !== 'remove') return { ok: false, message: 'شمارهٔ پورت LAN معتبر نیست.' };
  // The rule names are per-installation, so removal does not depend on the
  // current port; pass a safe placeholder if a damaged env file has no port.
  const numericPort = validPort ? requestedPort : 3000;
  if (!root || !program || !path.isAbsolute(program)) {
    return { ok: false, message: 'مسیر نصب یا Node.js برای تنظیم فایروال معتبر نیست.' };
  }

  let tempDir;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-firewall-'));
    const requestFile = path.join(tempDir, 'request.json');
    const resultFile = path.join(tempDir, 'result.json');
    fs.writeFileSync(requestFile, JSON.stringify({
      action,
      port: numericPort,
      program: path.resolve(program),
      ruleName: firewallRuleName(root),
    }), { encoding: 'utf8', mode: 0o600 });

    const child = spawnSync(powershellPath(), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, '-RequestFile', requestFile, '-ResultFile', resultFile,
    ], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });

    let payload = null;
    try {
      if (fs.existsSync(resultFile)) {
        const raw = fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '').trim();
        if (raw) payload = JSON.parse(raw);
      }
    } catch {
      payload = null;
    }

    if (child.error || child.status !== 0 || !payload) {
      return {
        ...(payload && typeof payload === 'object' ? payload : {}),
        ok: false,
        message: payload?.message
          || child.error?.message
          || (child.stderr || '').trim().slice(-1200)
          || 'تنظیم یا بررسی قانون فایروال LAN ناموفق بود.',
      };
    }
    return payload;
  } catch (error) {
    return { ok: false, message: `اجرای تنظیم فایروال LAN ناموفق بود: ${error?.message ?? error}` };
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
