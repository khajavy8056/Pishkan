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

rem --- encoding guard -------------------------------------------------------
rem Windows PowerShell 5.1 reads a .ps1 file with the ANSI code page unless it
rem starts with a UTF-8 BOM. These scripts contain Persian text; without the BOM
rem the parser fails with "Unexpected token ')'". The single line below is pure
rem ASCII on purpose: it re-adds the BOM if some tool (zip, editor, copy/paste)
rem stripped it, and does nothing when the BOM is already there.
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "foreach($f in @('%~dp0lib\installer-gui.ps1','%~dp0lib\ui.ps1','%~dp0lib\prereq.ps1')){ try { $b=[IO.File]::ReadAllBytes($f); if($b.Length -lt 3 -or $b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191){ $t=[IO.File]::ReadAllText($f,(New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllText($f,$t,(New-Object Text.UTF8Encoding($true))) } } catch { } }"
rem -------------------------------------------------------------------------

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
