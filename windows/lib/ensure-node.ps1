# Pishkan — automatic prerequisite bootstrap.
#
# Runs *before* the installer window when Node.js is missing or too old, so the
# goal «the installer installs whatever it needs» holds even on a bare Windows
# machine (no Node, no npm, no git):
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File windows\lib\ensure-node.ps1
#
# Order: winget (official OpenJS.NodeJS.LTS package) → official MSI from
# nodejs.org verified against SHASUMS256.txt, elevated with a single UAC prompt →
# clear Persian message. Exit code 0 means "node >= 22.22.2 is available now".
#
# Written for Windows PowerShell 5.1: ASCII source, UTF-8 BOM, CRLF (the linter
# in windows/lib/ps-lint.mjs enforces the encoding; the text is Persian).

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'prereq.ps1')

try {
  $result = Ensure-NodeRuntime
  foreach ($line in ($result.message -split "`n")) {
    if ($line.Trim()) { Write-Host $line }
  }
  if ($result.ok) {
    Write-Host ("Node.js {0} آماده است: {1}" -f $result.version, $result.node)
    Write-Host 'اکنون می‌توانید نصب را ادامه دهید.'
    exit 0
  }
  Write-Host 'نصب خودکار Node.js ناموفق بود.' -ForegroundColor Red
  Write-Host 'راه‌های جایگزین:' -ForegroundColor Yellow
  Write-Host '  1) winget install --id OpenJS.NodeJS.LTS --exact'
  Write-Host '  2) دانلود از https://nodejs.org/en/download (نسخه 22 LTS)'
  Write-Host 'سپس همین فایل را دوباره اجرا کنید.'
  exit 1
} catch {
  Write-Host ("خطای پیش‌نیاز: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
