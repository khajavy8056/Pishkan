@echo off
rem Pishkan - start the local server and open it in the browser.
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Run PishkanSetup.cmd first.
  pause
  exit /b 1
)
node "%ROOT%\windows\lib\manager.mjs" start --root "%ROOT%"
if errorlevel 1 (
  echo Failed to start Pishkan. Open PishkanManager.cmd for details.
  pause
  exit /b 1
)
node "%ROOT%\windows\lib\manager.mjs" open --root "%ROOT%"
endlocal
