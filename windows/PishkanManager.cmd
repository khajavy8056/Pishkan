@echo off
rem Pishkan - graphical manager launcher (start/stop/restart/logs/backup).
setlocal
chcp 65001 >nul
set "HERE=%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"

rem --- encoding guard -------------------------------------------------------
rem PowerShell 5.1 needs a UTF-8 BOM to read Persian text in a .ps1 file. This
rem ASCII-only line restores the BOM if it was stripped; otherwise it does nothing.
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "foreach($f in @('%~dp0lib\manager-gui.ps1','%~dp0lib\ui.ps1')){ try { $b=[IO.File]::ReadAllBytes($f); if($b.Length -lt 3 -or $b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191){ $t=[IO.File]::ReadAllText($f,(New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllText($f,$t,(New-Object Text.UTF8Encoding($true))) } } catch { } }"
rem -------------------------------------------------------------------------

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
