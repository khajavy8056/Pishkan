@echo off
rem Pishkan - stop the local server gracefully.
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. If a server is still running, use Task Manager.
  pause
  exit /b 1
)
node "%ROOT%\windows\lib\manager.mjs" stop --root "%ROOT%"
endlocal
