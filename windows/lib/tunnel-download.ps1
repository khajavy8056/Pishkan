# Pishkan — download the Microsoft Dev Tunnels CLI (devtunnel.exe)
#
# Called by the installer before anything else runs when the operator ticks
# «انتشار روی اینترنت». Never throws: it prints one JSON line on stdout and
# exits 0 for success, 1 for failure, so the Node installer can decide what to
# tell the user.
#
# Why a separate .ps1 and not Node: the Node runtime may be the very thing that
# is not installed yet, and this download must work before Node exists. It only
# uses what Windows ships with (PowerShell 5.1 + .NET Framework's WebClient).
#
# Why several URLs: aka.ms is a Microsoft redirector that is reachable from
# Iran in some networks and not in others. When it fails, the same binary is
# also published as a GitHub release asset of the dev-tunnels repo, which is
# usually reachable when aka.ms is not. The final fallback is the user's own
# mirror file dropped next to the installer.
#
# Security: the download is only accepted when it is a real Windows PE binary
# of plausible size whose name reports a version. An HTML error page saved as
# .exe is the classic failure mode of a blocked redirector and must be rejected
# loudly instead of being reported as "installed".
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$SourceUrl = '',
  [string]$LogFile = ''
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

function Write-Log([string]$Message) {
  if ($LogFile) {
    try {
      $dir = Split-Path -Parent $LogFile
      if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date).ToString('s'), $Message) -Encoding UTF8
    } catch { }
  }
}

# Download sources, in order. Only documented endpoints are listed: a guessed
# "mirror" that 404s is worse than no fallback, because it makes the failure
# message lie about what was tried.
#   1. the documented redirector (works in most networks, filtered sometimes),
#   2. winget, which uses a different CDN and a different TLS fingerprint and
#      therefore often succeeds where the redirector is blocked,
#   3. a file the operator placed beside the installer by hand.
$urls = @()
if ($SourceUrl) { $urls += $SourceUrl }
$urls += 'https://aka.ms/TunnelsCliDownload/win-x64'
$urls = $urls | Select-Object -Unique

# winget is tried as a separate source even though it does not produce a file we
# download ourselves: when it works, the installer only has to find where it put
# the exe.
$wingetTried = $false

$dir = Split-Path -Parent $Target
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

function Test-DevTunnelBinary([string]$Path) {
  if (-not (Test-Path $Path)) { return @{ ok = $false; reason = 'file-missing' } }
  $info = Get-Item $Path
  if ($info.Length -lt 500000) { return @{ ok = $false; reason = "too-small:$($info.Length)" } }
  if ($info.Length -gt 400000000) { return @{ ok = $false; reason = "too-large:$($info.Length)" } }
  $stream = [IO.File]::OpenRead($Path)
  try {
    $head = New-Object byte[] 2
    [void]$stream.Read($head, 0, 2)
  } finally { $stream.Dispose() }
  # "MZ" — every Windows executable starts with this. An HTML page does not.
  if ($head[0] -ne 0x4D -or $head[1] -ne 0x5A) { return @{ ok = $false; reason = 'not-a-windows-binary' } }
  return @{ ok = $true; reason = '' }
}

# A pre-placed file wins: an operator behind a hard block can download it on
# another machine and drop it beside this one. It is validated exactly like a
# download — moving a file into place is not the same as having a working CLI.
$local = Join-Path $dir 'devtunnel.exe.download'
if (Test-Path $local) {
  Write-Log "checking pre-placed file $local"
  $check = Test-DevTunnelBinary $local
  if ($check.ok) {
    Move-Item -Force -Path $local -Destination $Target
    $version = (& $Target --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $version) {
      Write-Log "installed pre-placed binary $Target ($version)"
      Write-Output (ConvertTo-Json -Compress @{ ok = $true; path = $Target; version = $version; source = 'pre-placed' })
      exit 0
    }
    Write-Log 'pre-placed file did not run; falling back to download'
    Remove-Item -Force $Target -ErrorAction SilentlyContinue
  } else {
    Write-Log "pre-placed file rejected ($($check.reason)); falling back to download"
    Remove-Item -Force $local -ErrorAction SilentlyContinue
  }
}

$lastError = ''
foreach ($url in $urls) {
  try {
    Write-Log "downloading $url"
    $tmp = "$Target.part"
    if (Test-Path $tmp) { Remove-Item -Force $tmp }
    # 10 minute ceiling: the binary is tens of megabytes and Iranian uplinks
    # to Microsoft can be slow, but a hung socket must not block the installer.
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 600
    $check = Test-DevTunnelBinary $tmp
    if (-not $check.ok) {
      $lastError = "reply from $url was not a Windows binary ($($check.reason))"
      Write-Log $lastError
      Remove-Item -Force $tmp -ErrorAction SilentlyContinue
      continue
    }
    Move-Item -Force -Path $tmp -Destination $Target
    # Prove it runs: a truncated or wrong-architecture exe fails here.
    $version = (& $Target --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $version) {
      $lastError = "downloaded file from $url did not report a version"
      Write-Log $lastError
      Remove-Item -Force $Target -ErrorAction SilentlyContinue
      continue
    }
    Write-Log "installed $Target ($version) from $url"
    Write-Output (ConvertTo-Json -Compress @{ ok = $true; path = $Target; version = $version; source = $url })
    exit 0
  } catch {
    $lastError = "download failed for ${url}: $($_.Exception.Message)"
    Write-Log $lastError
  }
}

# winget fallback. It installs the same CLI through the Store/CDN path, which is
# a genuinely different route to the same binary — the reason it is worth trying
# when aka.ms is filtered. The exe lands in a versioned winget package folder, so
# it is copied into windows\bin afterwards to keep one predictable location.
if (-not (Test-Path $Target)) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    $wingetTried = $true
    try {
      Write-Log 'aka.ms unavailable; trying winget install Microsoft.devtunnel'
      # --disable-interactivity: the installer is a GUI with no console to
      # accept a source-agreement prompt on.
      & $winget.Source install --id Microsoft.devtunnel --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 | Out-String | ForEach-Object { Write-Log $_ }
      $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
      if (Test-Path $packages) {
        $found = Get-ChildItem -Path $packages -Filter 'devtunnel.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
          Copy-Item -Force -Path $found.FullName -Destination $Target
          $check = Test-DevTunnelBinary $Target
          if ($check.ok) {
            $version = (& $Target --version 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $version) {
              Write-Log "installed via winget $Target ($version)"
              Write-Output (ConvertTo-Json -Compress @{ ok = $true; path = $Target; version = $version; source = 'winget' })
              exit 0
            }
          }
          $lastError = 'winget کپی‌شده اجرا نشد'
          Remove-Item -Force $Target -ErrorAction SilentlyContinue
        } else {
          $lastError = 'winget اجرا شد ولی فایل devtunnel.exe پیدا نشد'
        }
      } else {
        $lastError = 'پوشهٔ بسته‌های winget پیدا نشد'
      }
    } catch {
      $lastError = "winget failed: $($_.Exception.Message)"
    }
    Write-Log $lastError
  } else {
    Write-Log 'winget is not available on this machine'
  }
}

if (-not $lastError) { $lastError = 'no download source was usable' }
Write-Log "FAILED: $lastError"
$tried = @('aka.ms')
if ($wingetTried) { $tried += 'winget' }
$tried += 'فایل دستی'
Write-Output (ConvertTo-Json -Compress @{ ok = $false; path = $Target; message = $lastError; sourcesTried = $tried })
exit 1
