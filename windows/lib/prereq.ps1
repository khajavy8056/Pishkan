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

# An installer must be able to elevate itself for the one action that needs it
# (a machine-wide MSI). Everything else runs unprivileged.
function Test-PishkanElevated {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

# Where node.exe lives after an installation, even when PATH is stale.
function Get-PishkanNodePath {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Get-PishkanNodeVersion {
  $node = Get-PishkanNodePath
  if (-not $node) { return '' }
  try { return (& $node -p "process.versions.node" 2>$null) } catch { return '' }
}

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
    # A machine-wide MSI needs an elevated token. Without it msiexec returns 1603
    # and the user only sees "installation failed"; with -Verb RunAs Windows shows
    # the UAC prompt once, which is what a person expects from a setup program.
    $msiArgs = @('/i', "`"$msi`"", '/qn', '/norestart')
    if (Test-PishkanElevated) {
      $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru
    } else {
      $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Verb RunAs -Wait -PassThru
    }
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


<#
One call that makes the machine ready to run the installer: Node.js of the
required version and npm (which ships with it). No dialog, no "please press the
button" — the product decides. `-Force` re-installs even when Node looks fine
(used to repair a broken installation).

Returns @{ ok; message; node; version; installed }
#>
function Ensure-NodeRuntime {
  param([switch]$Force)

  $version = Get-PishkanNodeVersion
  if (-not $Force -and (Test-NodeVersion $version)) {
    $node = Get-PishkanNodePath
    # npm ships next to node.exe; checking the file is enough and does not depend
    # on a PATH that a fresh installation may not have refreshed yet.
    $npmOk = $false
    if ($node) {
      $npmCmd = Join-Path (Split-Path $node -Parent) 'npm.cmd'
      $npmOk = (Test-Path $npmCmd) -or [bool](Get-Command npm -ErrorAction SilentlyContinue)
    }
    if (-not $npmOk) {
      # npm is bundled with Node; if it is missing the installation is damaged.
      $repair = Install-NodeRuntime -PreferMsi
      return @{ ok = $repair.ok; message = ("npm پیدا نشد؛ Node.js دوباره نصب شد.`n" + $repair.message); node = (Get-PishkanNodePath); version = (Get-PishkanNodeVersion); installed = $repair.ok }
    }
    return @{ ok = $true; message = "Node.js $version و npm از قبل نصب هستند."; node = $node; version = $version; installed = $false }
  }

  if ($version -and -not (Test-NodeVersion $version)) {
    $intro = "Node.js $version قدیمی است (حداقل $script:RequiredNodeVersion لازم است)؛ نسخهٔ جدید نصب می‌شود."
  } else {
    $intro = 'Node.js نصب نیست؛ نسخهٔ رسمی به‌صورت خودکار نصب می‌شود.'
  }
  $result = Install-NodeRuntime
  Update-SessionPath
  $newVersion = Get-PishkanNodeVersion
  $ok = Test-NodeVersion $newVersion
  return @{
    ok = $ok
    message = ($intro + "`n" + $result.message)
    node = (Get-PishkanNodePath)
    version = $newVersion
    installed = $ok
  }
}
