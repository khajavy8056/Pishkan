@echo off
rem Pishkan - graphical installer launcher (double click this file).
rem The window is drawn by PowerShell (built into Windows); the installation
rem itself runs on Node.js. See windows\README-INSTALL.md.
rem
rem The installer is self-sufficient: if Node.js is missing or too old, the
rem official runtime is downloaded and installed before anything else runs.
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
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "foreach($f in @('%~dp0lib\installer-gui.ps1','%~dp0lib\ui.ps1','%~dp0lib\prereq.ps1','%~dp0lib\ensure-node.ps1')){ try { $b=[IO.File]::ReadAllBytes($f); if($b.Length -lt 3 -or $b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191){ $t=[IO.File]::ReadAllText($f,(New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllText($f,$t,(New-Object Text.UTF8Encoding($true))) } } catch { } }"
rem -------------------------------------------------------------------------

call :EnsureNode
if errorlevel 1 exit /b 1

"%PS%" -NoProfile -STA -ExecutionPolicy Bypass -File "%HERE%lib\installer-gui.ps1" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo The graphical installer exited with code %CODE%.
  echo Details: %HERE%..\.data\install-error.json
  echo GUI log : %HERE%..\.data\windows-gui-error.log
  echo You can retry with the console installer: PishkanSetup.cmd /console
  echo.
  pause
)
endlocal
exit /b 0

:console
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "foreach($f in @('%~dp0lib\setup-console.mjs','%~dp0lib\prereq.ps1','%~dp0lib\ensure-node.ps1')){ if ([IO.Path]::GetExtension($f) -ne '.ps1') { continue }; try { $b=[IO.File]::ReadAllBytes($f); if($b.Length -lt 3 -or $b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191){ $t=[IO.File]::ReadAllText($f,(New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllText($f,$t,(New-Object Text.UTF8Encoding($true))) } } catch { } }"
call :EnsureNode
if errorlevel 1 exit /b 1
node "%HERE%lib\setup-console.mjs" --root "%HERE%.."
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
endlocal
exit /b %CODE%

rem --- prerequisite bootstrap ------------------------------------------------
rem Installs Node.js (and therefore npm) automatically when it is missing.
rem Never asks a question: one UAC prompt is all Windows needs for a
rem machine-wide MSI. Returns 1 when the runtime could not be installed.
:EnsureNode
where node >nul 2>nul && exit /b 0
echo.
echo Node.js was not found. Pishkan installs the official runtime now...
echo This can take a few minutes; Windows may ask for permission once.
echo.
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%HERE%lib\ensure-node.ps1"
where node >nul 2>nul && exit /b 0
echo.
echo Node.js could not be installed automatically.
echo   1. Install Node.js 22 LTS from https://nodejs.org/en/download
echo   2. Run this file again.
echo.
pause
exit /b 1
