# Pishkan — Windows local installation (entry point)

فارسی در ادامهٔ همین فایل. English summary below.

این پوشه، نصب‌کننده و مدیر گرافیکی نسخهٔ محلی ویندوز است. برنامه همان کد مشترک
پروژه است و فقط پیکربندی/لانچرها مختص ویندوز هستند.

## شروع سریع (فارسی)

1. `PishkanSetup.cmd` را دوبار کلیک کنید (نصب‌کنندهٔ گرافیکی باز می‌شود).
2. مسیر نصب، پورت و اطلاعات «مدیر کل» را وارد کنید و «شروع نصب» را بزنید.
3. پس از پایان، دکمهٔ «باز کردن Pishkan» را بزنید یا از `PishkanManager.cmd` استفاده کنید.

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
| `lib/manager.mjs` | Service manager engine (used by the GUI and by `npm run windows:manager`). |
| `lib/verify.mjs` | Runtime verification + 19-step end-to-end workflow test. |
| `lib/syscheck.mjs` | System check (OS, Node, npm, disk, network, port, write access). |
| `lib/setup-console.mjs` | Text installer (`PishkanSetup.cmd /console`). |
| `lib/ui.ps1`, `lib/installer-gui.ps1`, `lib/manager-gui.ps1` | WinForms window, dark/light theme, RTL. |
| `lib/prereq.ps1` | Node.js installation (winget → official MSI with SHA-256 check). |
| `assets/pishkan.ico` | Generated icon (script: `lib/make-icon.mjs`). |
| `manifest/windows.manifest.json` | Version, requirements, isolation guarantees. |

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

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Unexpected token ')'` / `Missing closing '}'` when double-clicking `PishkanSetup.cmd` | The `.ps1` file lost its UTF-8 BOM, so PowerShell 5.1 read Persian text with the ANSI code page. Fixed in this version: every script ships with a BOM and the `.cmd` restores it if a tool strips it. Re-download the branch and try again. |
| `The property 'StandardInputEncoding' cannot be found on this object` | Windows with .NET Framework older than 4.7.2. Fixed in this version (the property is only set when the framework provides it and the job is sent as UTF-8 bytes). Update from GitHub; until then use `PishkanSetup.cmd /console`. |
| The window closes with «خطای غیرمنتظره» | The full exception is written to `.data\windows-gui-error.log`; send that file. The text installer `PishkanSetup.cmd /console` does not use .NET windows and keeps working. |
| `Node.js was not found` | The GUI shows a «نصب Node.js» button — press it (winget first, then the official MSI with SHA-256 verification). |
| `The graphical installer exited with code 1` | Read `.data\install-error.json`; it contains the failing step, the command, the exit code and the tail of the output. |
| Window opens but nothing happens on «بررسی سیستم» | Run `node windows\lib\syscheck.mjs --root . --port 3000 --pretty` in a terminal to see the same report as text. |
| `429` / «تلاش‌های ورود بیش از حد مجاز» | A verification run logs in six times; three runs in five minutes reach the default limit. Wait a minute or raise `AUTH_LOGIN_RATE_LIMIT` in `.env.windows.local`. |
| A failed install left a server running | Fixed: the installer stops the server it started (`stoppedServer` in `.data\install-error.json`) and a half-started process is cleaned up (`cleanedUp`). If you still see one, `PishkanManager.cmd` reports whether the port belongs to another program. |
| The port changed after a reinstall | If this installation's own server is running, the installer keeps its port. A different program on the port makes the installer pick the next free one — the report says which. |

## Important

* The local installation uses **SQLite** with `NODE_ENV=development`. Pishkan only
  allows SQLite outside production; production stays on PostgreSQL.
* `.env.windows.local` is a secret file (encryption key). It is git-ignored and
  must never be committed or shared.
* The installer never deletes an existing database, uploads folder or backup:
  re-running it is a repair/upgrade, not a wipe.
