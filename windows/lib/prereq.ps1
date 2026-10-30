# Pishkan — prerequisite helper (Node.js runtime).
#
# Used by the graphical installer only; it is the single piece of the setup that
# cannot be written in Node.js (it has to install Node.js itself).
#
# Order of preference:
#   1. winget (present on Windows 10 1809+ with App Installer) — official package
#      OpenJS.NodeJS.LTS, silent, no interaction.
#   2. Direct download of the official MSI from nodejs.org/dist, verified against
#      SHASUMS256.txt before running msiexec — works when winget is absent
#      (Windows Server, LTSC, Store removed, offline policy).
#
# Nothing is installed silently without the user pressing the button, and every
# failure returns a Persian message instead of throwing an unhandled exception.

$script:RequiredNodeVersion = '22.22.2'

function Get-RequiredNodeVersion { return $script:RequiredNodeVersion }

function Test-NodeVersion {
  param([string]$Version)
  if (-not $Version) { return $false }
  try {
    $current = [version]($Version.TrimStart('v'))
    return ($current -ge [version]$script:RequiredNodeVersion)
  } catch {
    return $false
  }
}

function Update-SessionPath {
  # A freshly installed Node.js is not in the PATH of the already running
  # PowerShell process; read it back from the registry instead of asking the
  # user to log out.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($machine + ';' + $user)
}

function Get-NodeInstallSummary {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $version = (& node -p "process.versions.node" 2>$null)
    if (Test-NodeVersion $version) { return "Node.js $version نصب است." }
    return "Node.js $version قدیمی است (حداقل $script:RequiredNodeVersion لازم است)."
  }
  return 'Node.js نصب نیست.'
}

function Install-NodeWithWinget {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { return @{ ok = $false; message = 'winget در دسترس نیست.' } }
  try {
    $process = Start-Process -FilePath $winget.Source -ArgumentList @(
      'install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--silent',
      '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
    ) -Wait -PassThru -NoNewWindow
    Update-SessionPath
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
      $version = (& node -p "process.versions.node" 2>$null)
      if (Test-NodeVersion $version) { return @{ ok = $true; message = "Node.js $version با winget نصب شد." } }
      return @{ ok = $false; message = "winget نسخه $version را نصب کرد که قدیمی است." }
    }
    return @{ ok = $false; message = "winget با کد $($process.ExitCode) تمام شد ولی node در PATH پیدا نشد." }
  } catch {
    return @{ ok = $false; message = "نصب با winget ناموفق بود: $($_.Exception.Message)" }
  }
}

function Install-NodeWithMsi {
  param([string]$Architecture = 'x64')
  $temp = Join-Path $env:TEMP ("pishkan-node-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  $msi = Join-Path $temp 'node.msi'
  $sums = Join-Path $temp 'SHASUMS256.txt'
  $file = "node-v$script:RequiredNodeVersion-$Architecture.msi"
  $base = "https://nodejs.org/dist/v$script:RequiredNodeVersion"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile $sums -UseBasicParsing -TimeoutSec 60
    Invoke-WebRequest -Uri "$base/$file" -OutFile $msi -UseBasicParsing -TimeoutSec 900
    $expected = $null
    foreach ($line in Get-Content $sums) {
      if ($line -match ([regex]::Escape($file) + '$')) {
        $expected = ($line -split '\s+')[0]
        break
      }
    }
    if (-not $expected) { return @{ ok = $false; message = 'چک‌سام رسمی برای فایل نصب پیدا نشد.' } }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $msi).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) {
      return @{ ok = $false; message = 'چک‌سام فایل دانلودشده با مقدار رسمی یکسان نیست؛ نصب متوقف شد.' }
    }
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
    Update-SessionPath
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
      $version = (& node -p "process.versions.node" 2>$null)
      if (Test-NodeVersion $version) { return @{ ok = $true; message = "Node.js $version از نصب‌کننده رسمی نصب شد." } }
    }
    return @{ ok = $false; message = "نصب‌کننده MSI با کد $($process.ExitCode) تمام شد ولی Node.js در PATH پیدا نشد. PowerShell را ببندید و دوباره باز کنید." }
  } catch {
    return @{ ok = $false; message = "دریافت یا نصب Node.js ناموفق بود: $($_.Exception.Message)" }
  } finally {
    Remove-Item -Recurse -Force -Path $temp -ErrorAction SilentlyContinue
  }
}

function Install-NodeRuntime {
  param([switch]$PreferMsi)
  $architecture = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $architecture = 'arm64' }

  if (Get-Command node -ErrorAction SilentlyContinue) {
    $version = (& node -p "process.versions.node" 2>$null)
    if (Test-NodeVersion $version) { return @{ ok = $true; message = "Node.js $version از قبل نصب است." } }
  }

  $attempts = @()
  if (-not $PreferMsi) { $attempts += 'winget' }
  $attempts += 'msi'

  $messages = @()
  foreach ($method in $attempts) {
    if ($method -eq 'winget') {
      $result = Install-NodeWithWinget
    } else {
      $result = Install-NodeWithMsi -Architecture $architecture
    }
    $messages += "[$method] $($result.message)"
    if ($result.ok) { return @{ ok = $true; message = ($messages -join "`n") } }
  }
  return @{ ok = $false; message = ($messages -join "`n") }
}
