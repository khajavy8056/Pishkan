@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1" %*
if errorlevel 1 (
  echo.
  echo Installation did not finish. Read the message above; existing data was not deleted.
  pause
  exit /b 1
)
echo.
pause
