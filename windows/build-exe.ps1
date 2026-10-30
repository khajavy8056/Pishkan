# Pishkan — optional: package the graphical installer as a single .exe
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File windows\build-exe.ps1
#
# IMPORTANT — read before using:
#   * This script must run on Windows; it cannot produce a valid PE executable
#     from any other operating system.
#   * It uses the community module `ps2exe` (PowerShell → .NET assembly). The
#     module is downloaded from the PowerShell Gallery, so a network connection
#     and a module-install permission are required.
#   * The resulting PishkanSetup.exe is NOT code-signed. Windows SmartScreen will
#     warn on first run ("Windows protected your PC"). For distribution to other
#     people you must sign it with an EV/OV code-signing certificate.
#   * The .cmd launchers in this folder are the supported, tested entry points;
#     the exe is a convenience wrapper with exactly the same behaviour.
#
# The .exe still needs the repository checkout next to it (it is a launcher, not
# a self-extracting archive): keep windows\PishkanSetup.exe inside the project
# folder, beside windows\PishkanSetup.cmd.

[CmdletBinding()]
param(
  [string]$OutputPath = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Source = Join-Path $PSScriptRoot 'lib\installer-gui.ps1'
$Icon = Join-Path $PSScriptRoot 'assets\pishkan.ico'
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot 'PishkanSetup.exe' }

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  Write-Error 'این اسکریپت فقط روی ویندوز اجرا می‌شود: ساخت فایل EXE نیاز به ویندوز و .NET دارد.'
}

if ((Test-Path $OutputPath) -and -not $Force) {
  Write-Error "فایل خروجی از قبل وجود دارد: $OutputPath (برای بازنویسی از -Force استفاده کنید)"
}

Write-Host 'بررسی ماژول ps2exe…' -ForegroundColor Cyan
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
  Write-Host 'نصب ماژول ps2exe برای کاربر جاری…' -ForegroundColor Yellow
  Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
}
Import-Module ps2exe

$arguments = @{
  InputFile = $Source
  OutputFile = $OutputPath
  Title = 'نصب Pishkan'
  Description = 'نصب‌کننده محلی Pishkan برای ویندوز'
  Company = 'Pishkan'
  Product = 'Pishkan'
  Version = (Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'manifest\windows.manifest.json') | ConvertFrom-Json).installerVersion
  NoConsole = $true
  STA = $true
  requireAdmin = $false
  SupportOS = $true
}
if (Test-Path $Icon) { $arguments['IconFile'] = $Icon }

Invoke-PS2EXE @arguments

if (Test-Path $OutputPath) {
  $size = [Math]::Round((Get-Item $OutputPath).Length / 1048576, 2)
  Write-Host "`nساخته شد: $OutputPath ($size MB)" -ForegroundColor Green
  Write-Host 'یادآوری: فایل امضا نشده است؛ برای توزیع عمومی باید امضای دیجیتال داشته باشد.' -ForegroundColor Yellow
  Write-Host 'پس از ساخت، فایل را کنار PishkanSetup.cmd و پوشه lib نگه دارید.' -ForegroundColor Gray
} else {
  Write-Error 'ساخت فایل EXE ناموفق بود.'
}
