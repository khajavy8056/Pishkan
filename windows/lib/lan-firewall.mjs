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
 * `runLanFirewall` never triggers UAC implicitly: a new rule requires the
 * installer/manager to already be elevated; an existing valid rule can be
 * checked and used by a standard user. When the operator explicitly asks to
 * "open the firewall for phones", `ensureLanFirewallElevated` performs the
 * same narrow rule creation through one standard Windows UAC prompt, so LAN
 * access works without hunting through firewall settings by hand.
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

function psQuote(value) {
  // PowerShell single-quoted string; apostrophes are doubled.
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Ensure the LAN firewall rule exists, asking for elevation once (UAC) when
 * the current process is not an administrator. This is the one-click path the
 * Manager's «باز کردن فایروال برای موبایل» button uses: the customer sees the
 * standard Windows prompt, clicks Yes, and phones on the office Wi-Fi can
 * reach Pishkan — whatever the firewall profile defaults were. The rule stays
 * narrow (Private profile, LocalSubnet, this install's program only).
 */
export function ensureLanFirewallElevated({ root, port, program = process.execPath, timeoutMs = 120_000 } = {}) {
  // Cheap path first: already elevated, or a valid rule already exists.
  const plain = runLanFirewall('ensure', { root, port, program });
  if (plain.ok) return plain;
  if (process.platform !== 'win32') return plain;

  const requestedPort = Number(port);
  if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
    return { ok: false, message: 'شمارهٔ پورت LAN معتبر نیست.' };
  }
  if (!root || !program || !path.isAbsolute(program)) {
    return { ok: false, message: 'مسیر نصب یا Node.js برای تنظیم فایروال معتبر نیست.' };
  }

  let tempDir;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-firewall-elevated-'));
    const requestFile = path.join(tempDir, 'request.json');
    const resultFile = path.join(tempDir, 'result.json');
    fs.writeFileSync(requestFile, JSON.stringify({
      action: 'ensure',
      port: requestedPort,
      program: path.resolve(program),
      ruleName: firewallRuleName(root),
    }), { encoding: 'utf8', mode: 0o600 });

    const innerArgs = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, '-RequestFile', requestFile, '-ResultFile', resultFile,
    ].map(psQuote).join(',');
    const command = `$p = Start-Process -FilePath ${psQuote(powershellPath())} -Verb RunAs -Wait -PassThru -ArgumentList @(${innerArgs}); if ($null -eq $p) { exit 2 }; exit $p.ExitCode`;
    const child = spawnSync(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });

    let payload = null;
    try {
      if (fs.existsSync(resultFile)) {
        const raw = fs.readFileSync(resultFile, 'utf8').replace(/^﻿/, '').trim();
        if (raw) payload = JSON.parse(raw);
      }
    } catch {
      payload = null;
    }

    if (payload?.ok) return payload;
    if (payload) return { ...payload, ok: false, message: payload.message || 'تنظیم فایروال با دسترسی مدیر هم انجام نشد.' };
    // No result file: the UAC prompt was most likely cancelled.
    return {
      ok: false,
      cancelled: true,
      message: 'پنجرهٔ تأیید Windows لغو شد یا دسترسی مدیر داده نشد؛ قانون فایروال ساخته نشد. سرویس همچنان در حال اجراست و هر وقت خواستید می‌توانید دوباره تلاش کنید.',
    };
  } catch (error) {
    return { ok: false, message: `اجرای تنظیم فایروال با دسترسی مدیر ناموفق بود: ${error?.message ?? error}` };
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
