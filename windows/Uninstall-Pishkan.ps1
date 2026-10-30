# Pishkan — uninstall the local Windows installation.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File windows\Uninstall-Pishkan.ps1            (interactive)
#   ... -KeepData                                            (remove shortcuts + build, keep .data)
#   ... -RemoveData -Force                                   (also delete the test database and uploads)
#
# What it does, in order:
#   1. stops the local server through the manager (graceful shutdown),
#   2. removes the desktop/start-menu shortcuts,
#   3. optionally deletes the local data (database, uploads, backups, settings).
#
# It NEVER touches the git history, it never deletes source files, and it asks
# before deleting any data. Backups are offered first.

param(
  [switch]$KeepData,
  [switch]$RemoveData,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$DataDir = Join-Path $RepoRoot '.data'
$EnvFile = Join-Path $RepoRoot '.env.windows.local'

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  ✓ $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "  ! $Text" -ForegroundColor Yellow }

Write-Host 'حذف نصب محلی Pishkan' -ForegroundColor White
Write-Host "پوشه: $RepoRoot"

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Write-Step 'توقف سرویس'
  & $node.Source (Join-Path $PSScriptRoot 'lib\manager.mjs') stop --root $RepoRoot
  Write-Ok 'درخواست توقف ارسال شد.'
} else {
  Write-Warn 'Node.js پیدا نشد؛ اگر سرویس در حال اجراست آن را از Task Manager ببندید.'
}

Write-Step 'حذف میان‌برها'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Create-Shortcuts.ps1') -Remove
Write-Ok 'میان‌برها حذف شدند.'

if ($RemoveData) { $KeepData = $false }
if (-not $KeepData -and -not $RemoveData) {
  $answer = Read-Host 'داده‌های آزمون (پایگاه داده، فایل‌ها، پشتیبان‌ها) هم حذف شوند؟ (y/N)'
  if ($answer -match '^(y|Y|ب|بله)$') { $RemoveData = $true } else { $KeepData = $true }
}

if ($RemoveData) {
  if (Test-Path $DataDir) {
    $backupTarget = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Pishkan-backup-' + (Get-Date).ToString('yyyyMMdd-HHmm'))
    Write-Step 'ساخت پشتیبان از داده‌های فعلی پیش از حذف'
    try {
      if (-not (Test-Path $backupTarget)) { New-Item -ItemType Directory -Force -Path $backupTarget | Out-Null }
      Copy-Item -Path (Join-Path $DataDir '*') -Destination $backupTarget -Recurse -Force -ErrorAction SilentlyContinue
      Copy-Item -Path $EnvFile -Destination $backupTarget -Force -ErrorAction SilentlyContinue
      Write-Ok "پشتیبان کپی شد: $backupTarget"
      Write-Warn 'این پشتیبان شامل فایل تنظیمات (کلید رمزنگاری) است؛ آن را در جای امن نگه دارید.'
    } catch {
      Write-Warn "ساخت پشتیبان ناموفق بود: $($_.Exception.Message)"
      if (-not $Force) {
        $continue = Read-Host 'بدون پشتیبان ادامه می‌دهید؟ (y/N)'
        if ($continue -notmatch '^(y|Y|ب|بله)$') { Write-Warn 'حذف داده لغو شد.'; return }
      }
    }
  }
  Write-Step 'حذف داده‌های محلی'
  if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir; Write-Ok "پوشه داده حذف شد: $DataDir" }
  if (Test-Path $EnvFile) { Remove-Item -Force $EnvFile; Write-Ok 'فایل تنظیمات محلی حذف شد.' }
} else {
  Write-Step 'داده‌های محلی حفظ شدند'
  Write-Ok "پایگاه داده و فایل‌ها در $DataDir باقی ماندند."
}

Write-Host "`nحذف نصب پایان یافت." -ForegroundColor White
Write-Host 'فایل‌های سورس پروژه دست‌نخورده‌اند؛ برای حذف کامل پوشه پروژه را خودتان پاک کنید.' -ForegroundColor Gray
