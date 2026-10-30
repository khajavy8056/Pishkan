@echo off
rem Pishkan - graphical manager launcher (start/stop/restart/logs/backup).
setlocal
chcp 65001 >nul
set "HERE=%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"

"%PS%" -NoProfile -STA -ExecutionPolicy Bypass -File "%HERE%lib\manager-gui.ps1" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo The manager exited with code %CODE%.
  echo You can use the command line instead, for example:
  echo   node windows\lib\manager.mjs status --root "%~dp0.."
  echo.
  pause
)
endlocal
