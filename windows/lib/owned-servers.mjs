/** Discover only Pishkan's directly launched API processes; never kill generic node.exe. */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { controlPipePath, envFilePath, legacyWindowsControlPipePath, pidAlive, sleep } from './common.mjs';
import { readEnvFile } from './envfile.mjs';

const entrySuffix = /(?:^|[\\/])apps[\\/]api[\\/]dist[\\/]index\.js$/i;

function rootForEntry(entry) {
  if (!entrySuffix.test(entry) || !path.isAbsolute(entry)) return null;
  const root = path.resolve(path.dirname(entry), '../../..');
  try {
    const api = JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8'));
    const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (api.name !== '@pishkan/api' || project.name !== 'pishkan' || !fs.existsSync(path.join(root, 'windows/lib/manager.mjs'))) return null;
    return root;
  } catch { return null; }
}

function windowsProcesses() {
  const script = "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('شناسایی امن فرایندهای ویندوز ممکن نشد؛ نصب متوقف شد.');
  let rows;
  try { rows = JSON.parse(result.stdout || '[]'); } catch { throw new Error('پاسخ فهرست فرایندهای ویندوز معتبر نیست؛ نصب متوقف شد.'); }
  return (Array.isArray(rows) ? rows : [rows]).map((row) => ({ pid: Number(row.ProcessId), command: row.CommandLine }));
}

function linuxProcesses() {
  if (!fs.existsSync('/proc/self/cmdline')) throw new Error('شناسایی امن فرایندها در این سیستم پشتیبانی نمی‌شود.');
  return fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name)).flatMap((pid) => {
    try {
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`).toString().split('\0').filter(Boolean);
      if (!/^(?:node|nodejs)$/i.test(path.basename(argv[0] || ''))) return [];
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      return [{ pid: Number(pid), argv, cwd }];
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error?.code)) return [];
      throw new Error('دسترسی کافی برای بررسی فرایندهای موجود نیست؛ نصب متوقف شد.');
    }
  });
}

export function listPishkanServers() {
  const rows = process.platform === 'win32' ? windowsProcesses() : linuxProcesses();
  const found = [];
  for (const row of rows) {
    if (row.pid === process.pid || !Number.isInteger(row.pid) || row.pid <= 0) continue;
    if (process.platform === 'win32' && typeof row.command !== 'string') {
      throw new Error('خط فرمان برخی فرایندهای Node قابل خواندن نیست؛ برای جلوگیری از توقف اشتباه، نصب متوقف شد.');
    }
    // Windows Node quotes an absolute script path when it contains spaces.
    const tokens = row.argv ?? [...row.command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
    const candidate = tokens.slice(1).find((arg) => entrySuffix.test(arg));
    if (!candidate) continue;
    const entry = path.isAbsolute(candidate) ? candidate : row.cwd ? path.resolve(row.cwd, candidate) : null;
    const root = entry && rootForEntry(entry);
    if (!root) throw new Error(`فرایند احتمالی Pishkan با شناسه ${row.pid} پیدا شد اما مسیر و مالکیت آن قابل تأیید نیست؛ نصب متوقف شد.`);
    found.push({ pid: row.pid, root });
  }
  return found;
}

function isAlive(pid) {
  if (!pidAlive(pid)) return false;
  if (process.platform === 'linux') {
    try { if (/^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))) return false; } catch { /* rely on pidAlive */ }
  }
  return true;
}

// /proc/net/unix identifies the listening socket inode, while /proc/PID/fd
// proves that exact process owns it. Never signal a reused PID or shared pipe.
function linuxPipeOwnedBy(pid, pipe) {
  try {
    const lines = fs.readFileSync('/proc/net/unix', 'utf8').split('\n');
    const inodes = new Set(lines.flatMap((line) => {
      const match = line.trim().match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(.+)$/);
      return match && match[2] === pipe ? [match[1]] : [];
    }));
    return fs.readdirSync(`/proc/${pid}/fd`).some((fd) => {
      try { const match = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/); return match && inodes.has(match[1]); } catch { return false; }
    });
  } catch { return false; }
}

function windowsShutdown(pid, pipe) {
  // Identify the server PID on the SAME connected handle before sending any
  // command: old copies may share the same basename-derived named pipe.
  const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; public static class PishkanPipeNative { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid); }'
$name=$env:PISHKAN_STOP_PIPE
if (-not $name.StartsWith('\\\\.\\pipe\\')) { throw 'Invalid pipe path' }
$name=$name.Substring(9)
$c=New-Object System.IO.Pipes.NamedPipeClientStream('.', $name, [System.IO.Pipes.PipeDirection]::InOut)
try {
  $c.Connect(3000)
  [uint32]$owner=0
  if (-not [PishkanPipeNative]::GetNamedPipeServerProcessId($c.SafePipeHandle, [ref]$owner) -or $owner -ne [uint32]$env:PISHKAN_STOP_PID) { throw 'Pipe owner mismatch' }
  $bytes=[System.Text.Encoding]::UTF8.GetBytes("shutdown\`n")
  $c.Write($bytes, 0, $bytes.Length); $c.Flush()
} finally { $c.Dispose() }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true, env: { ...process.env, PISHKAN_STOP_PIPE: pipe, PISHKAN_STOP_PID: String(pid) },
  });
  return !result.error && result.status === 0;
}

function linuxShutdown(pipe) {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipe);
    let accepted = false;
    socket.setTimeout(3000);
    socket.once('connect', () => socket.write('shutdown\n'));
    socket.on('data', (data) => { if (String(data).includes('bye')) accepted = true; });
    const done = () => { socket.destroy(); resolve(accepted); };
    socket.once('close', done); socket.once('error', done); socket.once('timeout', done);
  });
}

/** Stop verified processes gracefully; fail closed if identity/exit is uncertain. */
export async function stopPishkanServers({ onStop = () => {}, root = null } = {}) {
  const inScope = (server) => !root || (process.platform === 'win32' ? server.root.toLowerCase() === root.toLowerCase() : server.root === root);
  const servers = listPishkanServers().filter(inScope);
  for (const server of servers) {
    if (!isAlive(server.pid)) continue;
    const current = listPishkanServers().find((s) => s.pid === server.pid && s.root === server.root);
    if (!current) throw new Error(`هویت فرایند ${server.pid} تغییر کرد؛ نصب متوقف شد.`);
    const config = readEnvFile(envFilePath(server.root));
    const pipes = config.PISHKAN_CONTROL_PIPE ? [config.PISHKAN_CONTROL_PIPE] : [controlPipePath(server.root),
      ...(process.platform === 'win32' ? [legacyWindowsControlPipePath(server.root)] : [])];
    let sent = false;
    for (const pipe of pipes) {
      sent = process.platform === 'win32'
        ? windowsShutdown(server.pid, pipe)
        : linuxPipeOwnedBy(server.pid, pipe) && await linuxShutdown(pipe);
      if (sent) break;
    }
    if (!sent) throw new Error(`خاموشی امن Pishkan قبلی (PID ${server.pid}، مسیر ${server.root}) ممکن نشد. آن را از مدیر همان نصب متوقف و دوباره تلاش کنید؛ هیچ فرایند ناشناسی متوقف نشد.`);
    for (let n = 0; n < 80 && isAlive(server.pid); n += 1) await sleep(250);
    if (isAlive(server.pid)) throw new Error(`فرایند Pishkan قبلی (PID ${server.pid}) هنوز کاملاً متوقف نشده است؛ نصب برای حفاظت از داده ادامه نمی‌یابد.`);
    onStop(server);
  }
  const remaining = listPishkanServers().filter((server) => inScope(server) && isAlive(server.pid));
  if (remaining.length) throw new Error('یک سرویس دیگر Pishkan هنگام نصب شروع شد؛ آن را متوقف و نصب را دوباره اجرا کنید.');
  return servers.length;
}
