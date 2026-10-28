[CmdletBinding()]
param(
  [ValidateRange(0,65535)][int]$Port = 0,
  [switch]$IncludeDemoData,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $Root '.env.windows.local'
$DataDir = Join-Path $Root '.data'
$Database = Join-Path $DataDir 'pishkan-windows.sqlite'
$CredentialsFile = Join-Path $DataDir 'initial-admin-credentials.txt'
$GeneratedConfiguration = $false
$PendingInitialCredentials = $false

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  ✓ $Text" -ForegroundColor Green }
function Write-Fail([string]$Text) { throw $Text }
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function New-RandomHex([int]$Bytes) {
  $Buffer = [byte[]]::new($Bytes)
  $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Rng.GetBytes($Buffer) } finally { $Rng.Dispose() }
  return [BitConverter]::ToString($Buffer).Replace('-', '')
}

Write-Host 'Pishkan — نصب محلی Windows (SQLite، فقط برای توسعه و آزمون)' -ForegroundColor White
Write-Host "مسیر نصب: $Root"

$Node = Get-Command node -ErrorAction SilentlyContinue
$Npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $Node -or -not $Npm) {
  Write-Fail 'Node.js و npm پیدا نشد. Node.js نسخه 22.22.2 یا جدیدتر را نصب کنید، PowerShell را ببندید و دوباره باز کنید.'
}
$NodeVersion = (& node -p "process.versions.node" 2>$null).Trim()
$MinimumNodeVersion = [version]'22.22.2'
try { $ParsedNodeVersion = [version]$NodeVersion } catch { Write-Fail "نسخه Node.js قابل تشخیص نیست: $NodeVersion" }
if ($ParsedNodeVersion -lt $MinimumNodeVersion) {
  Write-Fail "نسخه Node.js نصب‌شده $NodeVersion است؛ نسخه 22.22.2 یا جدیدتر لازم است."
}
Write-Ok "Node.js $NodeVersion"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if (-not (Test-Path $EnvFile)) {
  if ($Port -le 0) { $Port = 3000 }
  if (Test-Path $Database) {
    Write-Fail 'پایگاه داده موجود است ولی فایل تنظیمات این نصب پیدا نشد. برای جلوگیری از اتصال اشتباه یا بازنویسی حساب‌ها، نصب متوقف شد؛ فایل تنظیمات/پشتیبان را بازیابی کنید یا یک پوشه خالی جدا برای آزمون انتخاب کنید.'
  }
  $AdminPassword = 'Pk!7' + (New-RandomHex 16)
  $EncryptionKey = New-RandomHex 32
  $Config = @(
    'NODE_ENV=development'
    'DB_DRIVER=sqlite'
    "SQLITE_FILE=$($Database.Replace('\', '/'))"
    'HOST=127.0.0.1'
    "PORT=$Port"
    "APP_URL=http://127.0.0.1:$Port"
    "API_URL=http://127.0.0.1:$Port"
    "CORS_ORIGINS=http://127.0.0.1:$Port,http://localhost:$Port"
    'COOKIE_SECURE=false'
    "APP_ENCRYPTION_KEY=$EncryptionKey"
    'BOOTSTRAP_ADMIN_USERNAME=admin'
    "BOOTSTRAP_ADMIN_PASSWORD=$AdminPassword"
    'BOOTSTRAP_ADMIN_NAME=مدیر کل محلی'
    'DEMO_MODE=false'
  ) -join "`n"
  Write-Utf8NoBom $EnvFile ($Config + "`n")
  $CredentialText = @(
    'اعتبارنامه اولیه مدیر کل — فقط برای نصب محلی و آزمون'
    'نام کاربری: admin'
    "رمز عبور: $AdminPassword"
    "نشانی محلی: http://127.0.0.1:$Port"
    'این فایل را منتشر یا برای سامانه عملیاتی استفاده نکنید.'
  ) -join "`n"
  Write-Utf8NoBom $CredentialsFile ($CredentialText + "`n")
  $GeneratedConfiguration = $true
  $PendingInitialCredentials = $true
  Write-Ok 'پیکربندی تازه SQLite و کلیدهای تصادفی محلی ساخته شد.'
} else {
  $ExistingConfig = Get-Content -Raw -Path $EnvFile
  if ($ExistingConfig -notmatch '(?m)^DB_DRIVER=sqlite\s*$') {
    Write-Fail '.env.windows.local موجود است اما DB_DRIVER=sqlite نیست؛ این نصب‌کننده فقط برای داده محلی SQLite است و تنظیمات موجود را تغییر نمی‌دهد.'
  }
  $PortMatch = [regex]::Match($ExistingConfig, '(?m)^PORT=(\d+)[ \t]*\r?$')
  if ($Port -le 0 -and $PortMatch.Success) { $Port = [int]$PortMatch.Groups[1].Value }
  elseif ($Port -gt 0 -and $PortMatch.Success -and $Port -ne [int]$PortMatch.Groups[1].Value) {
    $ExistingConfig = [regex]::Replace($ExistingConfig, '(?m)^PORT=\d+[ \t]*\r?$', "PORT=$Port")
    $ExistingConfig = [regex]::Replace($ExistingConfig, '(?m)^APP_URL=.*$', "APP_URL=http://127.0.0.1:$Port")
    $ExistingConfig = [regex]::Replace($ExistingConfig, '(?m)^API_URL=.*$', "API_URL=http://127.0.0.1:$Port")
    $ExistingConfig = [regex]::Replace($ExistingConfig, '(?m)^CORS_ORIGINS=.*$', "CORS_ORIGINS=http://127.0.0.1:$Port,http://localhost:$Port")
    Write-Utf8NoBom $EnvFile $ExistingConfig
    Write-Host "پورت محلی به $Port تغییر می‌کند؛ پایگاه داده و حساب‌ها حفظ می‌شوند." -ForegroundColor Yellow
  }
  if ($Port -le 0) { $Port = 3000 }
  $BootstrapMatch = [regex]::Match($ExistingConfig, '(?m)^BOOTSTRAP_ADMIN_PASSWORD=(.+)\s*$')
  if ($BootstrapMatch.Success -and (Test-Path $CredentialsFile)) {
    $AdminPassword = $BootstrapMatch.Groups[1].Value
    $PendingInitialCredentials = $true
  }
  Write-Ok 'تنظیمات موجود حفظ می‌شود؛ رمز/حساب و پایگاه داده بازنشانی نخواهند شد.'
}

Write-Step 'نصب بسته‌های قفل‌شده'
Push-Location $Root
try {
  & npm ci
  if ($LASTEXITCODE -ne 0) { Write-Fail "npm ci ناموفق بود (کد $LASTEXITCODE). اتصال اینترنت و registry.npmjs.org را بررسی کنید؛ داده محلی حذف نشده است." }

  Write-Step 'ساخت API و رابط کاربری'
  & npm run build
  if ($LASTEXITCODE -ne 0) { Write-Fail "Build ناموفق بود (کد $LASTEXITCODE). فایل‌های داده دست‌نخورده‌اند." }

  $env:PISHKAN_ENV_FILE = $EnvFile
  if ($GeneratedConfiguration) {
    Write-Step 'ساخت پایگاه داده، اجرای مهاجرت‌ها، نقش‌ها و کاتالوگ'
    if ($IncludeDemoData) { & npm run seed --workspace apps/api -- --demo }
    else { & npm run seed --workspace apps/api -- --catalog-only }
    if ($LASTEXITCODE -ne 0) { Write-Fail "ایجاد پایگاه داده/مدیر اولیه شکست خورد (کد $LASTEXITCODE). داده‌ها را حذف نکنید؛ خروجی خطا را بررسی کنید." }
  } elseif ($IncludeDemoData) {
    Write-Host 'داده نمایشی به نصب موجود اضافه نمی‌شود؛ برای جلوگیری از مخلوط شدن داده‌های نمونه با اطلاعات قبلی از پوشه SQLite خالی استفاده کنید.' -ForegroundColor Yellow
  }

  Write-Step 'راه‌اندازی سرور محلی'
  & (Join-Path $PSScriptRoot 'start-windows.ps1') -Port $Port -NoBrowser:$NoBrowser
  if ($LASTEXITCODE -ne 0) { Write-Fail 'راه‌اندازی سرور کامل نشد. گزارش در .data\pishkan-windows-server.log است.' }

  if ($PendingInitialCredentials) {
    # The bootstrap secret is no longer needed after the first admin was created.
    $Sanitized = Get-Content -Raw -Path $EnvFile
    $Sanitized = [regex]::Replace($Sanitized, '(?m)^BOOTSTRAP_ADMIN_PASSWORD=.*(?:\r?\n|$)', '')
    Write-Utf8NoBom $EnvFile $Sanitized
    Write-Host "`n================ رمز مدیر کل ================" -ForegroundColor Yellow
    Write-Host 'نام کاربری: admin' -ForegroundColor White
    Write-Host "رمز عبور: $AdminPassword" -ForegroundColor White
    Write-Host "ذخیرهٔ محلی: $CredentialsFile" -ForegroundColor Gray
    Write-Host 'پس از ورود، این رمز را از بخش کارکنان/امنیت تغییر دهید. رمز در Git یا API قرار نگرفته است.' -ForegroundColor Yellow
    Write-Host '==============================================='
  }

  Write-Host "`nپیش‌نمایش: http://127.0.0.1:$Port" -ForegroundColor Green
  Write-Host 'ورود مدیر/کارکنان از دکمه «ورود کارکنان و مدیران» انجام می‌شود. دیتابیس در .data\pishkan-windows.sqlite است.'
  if ($IncludeDemoData -and $GeneratedConfiguration) {
    Write-Host 'داده‌های نمایشی فعال‌اند؛ حساب‌های نمونه فقط برای آزمایش محلی‌اند: sara / Demo@12345، reza / Demo@12345، maryam / Demo@12345، hesam / Demo@12345.' -ForegroundColor Yellow
  }
} finally {
  Pop-Location
}
