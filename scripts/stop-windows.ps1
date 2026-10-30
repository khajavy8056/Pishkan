$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$DataDir = Join-Path $Root '.data'
$PidFile = Join-Path $DataDir 'pishkan-windows.pid'
if (-not (Test-Path $PidFile)) {
  Write-Host 'شناسهٔ پردازه ذخیره نشده است؛ پایگاه داده/فایل‌ها تغییری نکردند.' -ForegroundColor Yellow
  return
}
try { $ProcessId = [int](Get-Content -Raw $PidFile).Trim() }
catch { throw 'شناسهٔ پردازه نامعتبر است. برای ایمنی هیچ پردازه‌ای متوقف نشد.' }
$Process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
if (-not $Process) {
  Remove-Item $PidFile -Force
  Write-Host 'سرور از قبل متوقف شده بود.' -ForegroundColor Yellow
  return
}
$Expected = [regex]::Escape((Join-Path $Root 'apps\api\dist\index.js'))
if ($Process.Name -notmatch '^node(\.exe)?$' -or $Process.CommandLine -notmatch $Expected) {
  throw "PID $ProcessId دیگر به سرور پشکان تعلق ندارد؛ برای ایمنی متوقف نشد."
}
Stop-Process -Id $ProcessId -ErrorAction Stop
Remove-Item $PidFile -Force
Write-Host 'سرور متوقف شد؛ پایگاه SQLite و فایل‌های آپلود دست‌نخورده باقی ماندند.' -ForegroundColor Green
