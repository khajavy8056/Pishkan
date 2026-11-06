# Pishkan — Windows local installation (entry point)

فارسی در ادامهٔ همین فایل. English summary below.

این پوشه، نصب‌کننده و مدیر گرافیکی نسخهٔ محلی ویندوز است. برنامه همان کد مشترک
پروژه است و فقط پیکربندی/لانچرها مختص ویندوز هستند.

## شروع سریع (فارسی)

1. `PishkanSetup.cmd` را دوبار کلیک کنید (نصب‌کنندهٔ گرافیکی باز می‌شود).
2. مسیر نصب، پورت و اطلاعات «مدیر کل» را وارد کنید. دسترسی موبایل در Wi‑Fi به‌صورت پیش‌فرض خاموش است؛ فقط اگر عمداً می‌خواهید از شبکهٔ محلی وصل شوید، گزینهٔ LAN را روشن کنید (نیازمند اجرای نصب‌کننده با Administrator).
3. «شروع نصب» را بزنید. پس از پایان، دکمهٔ «باز کردن Pishkan» را بزنید یا از `PishkanManager.cmd` برای دیدن URLهای خصوصی استفاده کنید.

راهنمای کامل: [`docs/WINDOWS-INSTALL-FA.md`](../docs/WINDOWS-INSTALL-FA.md)
حذف نصب: [`docs/WINDOWS-UNINSTALL-FA.md`](../docs/WINDOWS-UNINSTALL-FA.md)
به‌روزرسانی: [`docs/WINDOWS-UPDATE-FA.md`](../docs/WINDOWS-UPDATE-FA.md)
گزارش آزمون‌ها: [`docs/WINDOWS-LOCAL-TEST-REPORT-2026-10-30.md`](../docs/WINDOWS-LOCAL-TEST-REPORT-2026-10-30.md)

## Files

| File | Purpose |
| --- | --- |
| `PishkanSetup.cmd` | Double-click installer (WinForms GUI). `/console` runs the text installer. |
| `PishkanManager.cmd` | Manager window: start / stop / restart / status / logs / backup / restore. |
| `Start-Pishkan.cmd`, `Stop-Pishkan.cmd` | Start (and open the browser) or stop the server. |
| `Create-Shortcuts.ps1` | Start-menu + desktop shortcuts (`-Remove` to delete them). |
| `Uninstall-Pishkan.ps1` | Stops the server, removes shortcuts, optionally deletes the local data. |
| `build-exe.ps1` | Optional: package the installer as `PishkanSetup.exe` (Windows only, unsigned). |
| `lib/installer.mjs` | Installation engine (env file, dependencies, build, database, admin, start, verify). |
| `lib/manager.mjs` | Service manager engine (used by the GUI and by `npm run windows:manager`); writes diagnostics to `.data/logs/pishkan-manager.log`. |
| `lib/lan-access.mjs`, `lib/lan-firewall.mjs`, `lib/lan-firewall.ps1`, `lib/lan-guard.mjs` | Optional LAN opt-in, private IPv4 discovery, exact scoped Windows Firewall rules, and a watchdog that fails closed if the firewall changes or becomes unavailable while the API is running. |
| `lib/verify.mjs` | Runtime verification + 19-step end-to-end workflow test. |
| `lib/syscheck.mjs` | System check (OS, Node, npm, disk, network, port, write access). |
| `lib/setup-console.mjs` | Text installer (`PishkanSetup.cmd /console`). |
| `lib/ui.ps1`, `lib/installer-gui.ps1`, `lib/manager-gui.ps1` | WinForms window, dark/light theme, RTL. |
| `lib/prereq.ps1` | Node.js installation (winget → official MSI with SHA-256 check). |
| `assets/pishkan.ico` | Generated icon (script: `lib/make-icon.mjs`). |
| `manifest/windows.manifest.json` | Version, requirements, isolation guarantees. |

## Dependency repair regression test

`npm run test:windows:deps` copies the project and installed dependency tree to a temporary fixture and runs the actual installer, builds, SQLite and service verification. It needs Node 22, an existing `node_modules`, sufficient disk space and registry access or a warm npm cache. It does not validate the Windows GUI or firewall.

## Commands (no GUI)

```bat
node windows\lib\manager.mjs status  --root .
node windows\lib\manager.mjs start   --root .
node windows\lib\manager.mjs stop    --root .
node windows\lib\manager.mjs restart --root .
node windows\lib\manager.mjs logs    --root . --lines 60
node windows\lib\manager.mjs backup  --root .
node windows\lib\manager.mjs restore --root . --file .data\backups\<file>.sqlite
node windows\lib\verify.mjs --mode core --url http://127.0.0.1:3000 --env .env.windows.local
```

## Prerequisites are installed automatically

| Missing | What the installer does |
| --- | --- |
| Node.js (absent or too old) | Installs it: `winget` (official `OpenJS.NodeJS.LTS`) → official MSI from nodejs.org verified against `SHASUMS256.txt` |
| npm | Ships with Node; a damaged install is repaired by reinstalling Node.js |
| Administrator rights | Only for the machine-wide Node.js MSI — Windows shows one UAC prompt, the rest runs unprivileged |
| npm packages (~670) | Fresh tree: `npm ci`; existing tree: `npm install`, followed by `npm ls`. On a missing-module build failure, one clean `npm ci` and build retry. Network access or a populated cache may be needed. |

This happens in `PishkanSetup.cmd` before the window opens, again inside the window
(«بررسی سیستم» / «نصب»), and on the `/console` path. No manual download step.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Unexpected token ')'` / `Missing closing '}'` when double-clicking `PishkanSetup.cmd` | The `.ps1` file lost its UTF-8 BOM, so PowerShell 5.1 read Persian text with the ANSI code page. Fixed in this version: every script ships with a BOM and the `.cmd` restores it if a tool strips it. Re-download the branch and try again. |
| `The property 'StandardInputEncoding' cannot be found on this object` | Windows with .NET Framework older than 4.7.2. Fixed in this version (the property is only set when the framework provides it and the job is sent as UTF-8 bytes). Update from GitHub; until then use `PishkanSetup.cmd /console`. |
| `ورودی تنظیمات نصب‌کننده معتبر نیست (JSON)` | The window sent the job pretty-printed (PowerShell 5.1 formats `ConvertTo-Json` over many lines without `-Compress`). Fixed: the GUI compresses and the engine accepts multi-line JSON. Update from GitHub. |
| The window closes with «خطای غیرمنتظره» | The full exception is written to `.data\windows-gui-error.log`; send that file. The text installer `PishkanSetup.cmd /console` does not use .NET windows and keeps working. |
| `Node.js was not found` | The GUI shows a «نصب Node.js» button — press it (winget first, then the official MSI with SHA-256 verification). |
| `The graphical installer exited with code 1` | Read `.data\install-error.json`; it contains the failing step, the command, the exit code and the tail of the output. |
| Window opens but nothing happens on «بررسی سیستم» | Run `node windows\lib\syscheck.mjs --root . --port 3000 --pretty` in a terminal to see the same report as text. |
| Install finishes but no super-admin account exists («اطلاعات مدیر کل داده نشد») | **Root cause fixed**: the GUI built the job with `admin = { ... }` — a PowerShell *scriptblock*, not a hashtable — so `ConvertTo-Json` never delivered the typed credentials and the engine silently skipped admin creation. Update the code and re-run setup. The installer now also refuses to report success when no admin account exists and none was supplied, and rejects a malformed admin block up front. |
| Start completely from scratch | Tick **«نصب تمیز» (clean install)** in the setup window (or answer yes in the text installer). The previous database + env file are moved to `.data/previous-install-<timestamp>/`, stale build output is deleted, and the install proceeds from zero. Normal re-runs keep updating in place without touching data. |
| Re-install «succeeds» but the typed admin password cannot log in | Fixed in this version: the installer now runs `create-admin --upsert`, so re-running setup resets that admin's password to the typed one (or creates/verifies the account), and the final verification performs a real login with the entered credentials — an install only reports success when those credentials actually work. |
| Manager says «متوقف است» and Start seems to do nothing | The manager now never lets LAN/firewall trouble block the local service: start falls back to loopback with a visible warning. The real boot failure reason is shown in the log pane (the server *error* log is merged in) and in the start dialog. Other usual causes: a leftover `node.exe` from earlier installs (end it in Task Manager), or another program on the port. Manager actions also run asynchronously now, so the window no longer freezes during a slow start. |
| `429` / «تلاش‌های ورود بیش از حد مجاز» | A verification run logs in six times; three runs in five minutes reach the default limit. Wait a minute or raise `AUTH_LOGIN_RATE_LIMIT` in `.env.windows.local`. |
| «فایروال Windows باید در هر سه پروفایل روشن و ورودی پیش‌فرض مسدود باشد» | LAN stays off but the install now completes on loopback (the installer never changes global firewall policy). Fix in an elevated PowerShell: `Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True -DefaultInboundAction Block`, then re-run the installer as administrator with LAN ticked. A third-party antivirus firewall that replaces Windows Firewall also causes this. |
| A failed install left a server running | Fixed: the installer stops the server it started (`stoppedServer` in `.data\install-error.json`) and a half-started process is cleaned up (`cleanedUp`). If you still see one, `PishkanManager.cmd` reports whether the port belongs to another program. |
| The port changed after a reinstall | If this installation's own server is running, the installer keeps its port. A different program on the port makes the installer pick the next free one — the report says which. |

## Important

* The local installation uses **SQLite** with `NODE_ENV=development`. Pishkan only
  allows SQLite outside production; production stays on PostgreSQL.
* `.env.windows.local` is a secret file (encryption key). It is git-ignored and
  must never be committed or shared.
* The installer never deletes an existing database, uploads folder or backup:
  re-running it is a repair/upgrade, not a wipe.
