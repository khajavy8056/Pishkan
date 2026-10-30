# Pishkan — create Start-menu and desktop shortcuts.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File windows\Create-Shortcuts.ps1
#   ... -Remove     (delete the shortcuts again)
#
# Creates:
#   Start menu  > Pishkan  > نصب Pishkan / مدیریت Pishkan / اجرای Pishkan / توقف Pishkan
#   Desktop               > مدیریت Pishkan  (and اجرای Pishkan)
#
# Shortcuts point at the .cmd launchers inside the repository folder, so they
# keep working after an update (`git pull`) without being recreated.

param(
  [switch]$Remove,
  [switch]$NoDesktop
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StartMenuRoot = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Pishkan'
$Desktop = [Environment]::GetFolderPath('Desktop')
$Icon = Join-Path $PSScriptRoot 'assets\pishkan.ico'

$items = @(
  @{ Name = 'مدیریت Pishkan'; Target = (Join-Path $PSScriptRoot 'PishkanManager.cmd'); Desktop = $true; Description = 'شروع/توقف سرویس و مشاهده وضعیت' },
  @{ Name = 'اجرای Pishkan'; Target = (Join-Path $PSScriptRoot 'Start-Pishkan.cmd'); Desktop = $true; Description = 'راه‌اندازی و باز کردن برنامه در مرورگر' },
  @{ Name = 'توقف Pishkan'; Target = (Join-Path $PSScriptRoot 'Stop-Pishkan.cmd'); Desktop = $false; Description = 'توقف امن سرویس' },
  @{ Name = 'نصب دوباره / تعمیر'; Target = (Join-Path $PSScriptRoot 'PishkanSetup.cmd'); Desktop = $false; Description = 'اجرای دوباره نصب‌کننده (داده‌ها حفظ می‌شود)' }
)

if ($Remove) {
  foreach ($dir in @($StartMenuRoot, $Desktop)) {
    foreach ($item in $items) {
      $path = Join-Path $dir ("{0}.lnk" -f $item.Name)
      if (Test-Path $path) { Remove-Item -Force $path }
    }
  }
  if ((Test-Path $StartMenuRoot) -and -not (Get-ChildItem $StartMenuRoot)) { Remove-Item -Force $StartMenuRoot }
  Write-Host 'میان‌برهای Pishkan حذف شدند.' -ForegroundColor Yellow
  return
}

if (-not (Test-Path $StartMenuRoot)) { New-Item -ItemType Directory -Force -Path $StartMenuRoot | Out-Null }
$shell = New-Object -ComObject WScript.Shell

function New-Shortcut([string]$Path, [string]$Target, [string]$Description) {
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.WorkingDirectory = $RepoRoot
  $link.Description = $Description
  if (Test-Path $Icon) { $link.IconLocation = $Icon }
  $link.WindowStyle = 7   # minimised console window; the GUI window is what the user sees
  $link.Save()
}

foreach ($item in $items) {
  New-Shortcut (Join-Path $StartMenuRoot ("{0}.lnk" -f $item.Name)) $item.Target $item.Description
  if ($item.Desktop -and -not $NoDesktop) {
    New-Shortcut (Join-Path $Desktop ("{0}.lnk" -f $item.Name)) $item.Target $item.Description
  }
}

Write-Host "میان‌برها ساخته شدند:`n  $StartMenuRoot" -ForegroundColor Green
if (-not $NoDesktop) { Write-Host '  Desktop: مدیریت Pishkan و اجرای Pishkan' -ForegroundColor Green }
