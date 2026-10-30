@echo off
rem Pishkan - graphical installer launcher (double click this file).
rem The window is drawn by PowerShell (built into Windows); the installation
rem itself runs on Node.js. See windows\README-INSTALL.md.
setlocal
chcp 65001 >nul
set "HERE=%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"

rem /console forces the text installer (no GUI).
if /i "%~1"=="/console" goto console
if /i "%~1"=="--console" goto console

"%PS%" -NoProfile -STA -ExecutionPolicy Bypass -File "%HERE%lib\installer-gui.ps1" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo The graphical installer exited with code %CODE%.
  echo Details: %HERE%..\.data\install-error.json
  echo You can retry with the console installer: PishkanSetup.cmd /console
  echo.
  pause
)
endlocal
exit /b 0

:console
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. The graphical installer can install it for you:
  echo   PishkanSetup.cmd
  pause
  exit /b 1
)
node "%HERE%lib\setup-console.mjs" --root "%HERE%.."
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
endlocal
exit /b %CODE%
