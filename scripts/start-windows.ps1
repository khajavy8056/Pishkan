[CmdletBinding()]
param(
  [int]$Port = 0,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $Root '.env.windows.local'
$DataDir = Join-Path $Root '.data'
$PidFile = Join-Path $DataDir 'pishkan-windows.pid'
$Stdout = Join-Path $DataDir 'pishkan-windows-server.log'
$Stderr = Join-Path $DataDir 'pishkan-windows-server-error.log'
$Entry = Join-Path $Root 'apps\api\dist\index.js'

if (-not (Test-Path $EnvFile)) { throw 'تنظیمات محلی پیدا نشد. ابتدا Install-Pishkan-Windows.cmd را اجرا کنید.' }
if (-not (Test-Path $Entry)) { throw 'فایل اجرایی API موجود نیست؛ ابتدا نصب‌کننده را اجرا کنید تا npm run build انجام شود.' }
$Config = Get-Content -Raw -Path $EnvFile
if ($Port -le 0) {
  $Match = [regex]::Match($Config, '(?m)^PORT=(\d+)\s*$')
  if (-not $Match.Success) { throw 'PORT در .env.windows.local تعریف نشده است.' }
  $Port = [int]$Match.Groups[1].Value
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:PISHKAN_ENV_FILE = $EnvFile

try {
  $ExistingHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
  if ($ExistingHealth.ok -and $ExistingHealth.status -eq 'ok') {
    Write-Host "پیشکان از قبل فعال است: http://127.0.0.1:$Port" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
    return
  }
} catch { }

$Listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Listener) { throw "پورت $Port در حال استفاده است، اما پاسخ سامانه پیشکان نیست. برنامهٔ دیگر را خودتان بررسی/متوقف کنید؛ نصب‌کننده پردازه‌ای را نمی‌بندد." }

$ServerProcess = Start-Process -FilePath 'node' `
  -ArgumentList @('--experimental-sqlite', "`"$Entry`"") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $Stdout `
  -RedirectStandardError $Stderr `
  -PassThru
Set-Content -Path $PidFile -Value $ServerProcess.Id -Encoding ascii

$Healthy = $false
for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    if ($Health.ok -and $Health.status -eq 'ok') { $Healthy = $true; break }
  } catch { }
  $ServerProcess.Refresh()
  if ($ServerProcess.HasExited) { break }
}
if (-not $Healthy) {
  $Tail = if (Test-Path $Stderr) { (Get-Content $Stderr -Tail 20) -join "`n" } else { 'گزارش خطا هنوز خالی است.' }
  throw "سرور روی پورت $Port آماده نشد. گزارش: $Stderr`n$Tail"
}
Write-Host "پیشکان آماده است: http://127.0.0.1:$Port (pid=$($ServerProcess.Id))" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
