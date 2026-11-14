param(
  [Parameter(Mandatory = $true)][string]$RequestFile,
  [Parameter(Mandatory = $true)][string]$ResultFile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Pragmatic LAN rule management for the office install. One narrow inbound
# ALLOW rule lets phones on the same Wi-Fi reach this install's Node server:
#   exact TCP port + this install's node.exe + RemoteAddress LocalSubnet,
#   on ANY firewall profile (home/office Wi-Fi is often categorised Public),
# plus it disables the classic killer: Windows' own program-scoped BLOCK rule
# for node.exe (created when someone once clicked "Cancel" on the firewall
# prompt), which would otherwise override any allow rule. Other pre-existing
# rules are reported, never treated as a reason to refuse setup.

function Write-Result([hashtable]$Payload) {
  $directory = Split-Path -Parent $ResultFile
  if ($directory -and -not (Test-Path $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $json = $Payload | ConvertTo-Json -Depth 5 -Compress
  [IO.File]::WriteAllText($ResultFile, $json, (New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false))
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-ContainsValue($Values, [string]$Expected) {
  foreach ($value in @($Values)) {
    if ([string]$value -ieq $Expected) { return $true }
  }
  return $false
}

function Test-CoversAllProfiles($Profile) {
  $text = ([string]$Profile).Trim()
  if ($text -ieq 'Any') { return $true }
  $values = @($text -split '[,; ]+' | Where-Object { $_ })
  return (Test-ContainsValue $values 'Domain') -and (Test-ContainsValue $values 'Private') -and (Test-ContainsValue $values 'Public')
}

function Test-PortCouldMatch($LocalPorts, [int]$Port) {
  foreach ($value in @($LocalPorts)) {
    $text = [string]$value
    if ($text -ieq 'Any' -or $text -eq '*') { return $true }
    if ($text -match '^\d+$' -and [int]$text -eq $Port) { return $true }
    if ($text -match '^(\d+)-(\d+)$' -and $Port -ge [int]$Matches[1] -and $Port -le [int]$Matches[2]) { return $true }
  }
  return $false
}

function Test-ExactPort($LocalPorts, [int]$Port) {
  $values = @($LocalPorts | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  if ($values.Count -ne 1 -or $values[0] -notmatch '^\d+$') { return $false }
  $parsedPort = 0
  if (-not [int]::TryParse($values[0], [ref]$parsedPort)) { return $false }
  return $parsedPort -eq $Port
}

function Test-ExactValueSet($Values, [string]$Expected) {
  $actual = @($Values | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  $required = @($Expected -split '[,; ]+' | Where-Object { $_ })
  if ($actual.Count -ne $required.Count) { return $false }
  foreach ($value in $required) {
    if (-not (Test-ContainsValue $actual $value)) { return $false }
  }
  return $true
}

function Get-FirewallProfilesInfo {
  try {
    $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -Profile Domain,Private,Public -ErrorAction Stop)
  } catch {
    # Firewall service stopped/unreadable: nothing filters the traffic.
    return @{ allOff = $true; profiles = @() }
  }
  $list = @($profiles | ForEach-Object { @{
    name = [string]$_.Name
    enabled = ([string]$_.Enabled -in @('True', '1'))
    defaultInboundAction = [string]$_.DefaultInboundAction
  } })
  $enabledAny = @($list | Where-Object { $_.enabled }).Count -gt 0
  return @{ allOff = (-not $enabledAny); profiles = $list }
}

function Get-Rule([string]$Name) {
  return Get-NetFirewallRule -PolicyStore PersistentStore -Name $Name -ErrorAction SilentlyContinue
}

function Test-OwnAllowShape($Rule, [int]$Port, [string]$Program) {
  if (-not $Rule) { return $false }
  if ([string]$Rule.Enabled -notin @('True', '1')) { return $false }
  if ([string]$Rule.Direction -ne 'Inbound' -or [string]$Rule.Action -ne 'Allow') { return $false }
  if (-not (Test-CoversAllProfiles $Rule.Profile)) { return $false }
  if ([string]$Rule.EdgeTraversalPolicy -ne 'Block') { return $false }
  $portFilter = $Rule | Get-NetFirewallPortFilter
  if ([string]$portFilter.Protocol -notin @('TCP', '6')) { return $false }
  if (-not (Test-ExactPort $portFilter.LocalPort $Port)) { return $false }
  $appFilter = $Rule | Get-NetFirewallApplicationFilter
  if ([string]$appFilter.Program -ine $Program) { return $false }
  $addressFilter = $Rule | Get-NetFirewallAddressFilter
  if (-not (Test-ExactValueSet $addressFilter.RemoteAddress 'LocalSubnet')) { return $false }
  return $true
}

function Get-OwnRuleState([string]$RuleName, [int]$Port, [string]$Program) {
  $allow = Get-Rule "$RuleName-LanAllow"
  $legacyAllow = Get-Rule "$RuleName-PrivateAllow"
  $legacyBlock = Get-Rule "$RuleName-PublicBlock"
  return @{
    configured = (Test-OwnAllowShape $allow $Port $Program)
    allowRule = [bool]$allow
    legacyRules = ([bool]$legacyAllow -or [bool]$legacyBlock)
  }
}

# Enabled inbound BLOCK rules that would override our allow rule for this
# install: program-scoped to our node.exe (the classic Windows prompt rule),
# or an Any-program rule pinned to exactly our port. Returned for disabling.
function Find-BlockerRules([string]$RuleName, [int]$Port, [string]$Program) {
  $hits = @()
  try {
    $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound -Action Block -ErrorAction Stop)
  } catch { return @() }
  foreach ($rule in $rules) {
    if ([string]$rule.Name -like "$RuleName-*") { continue }
    $appFilter = $rule | Get-NetFirewallApplicationFilter
    $ruleProgram = [string]$appFilter.Program
    $portFilter = $rule | Get-NetFirewallPortFilter
    if ([string]$portFilter.Protocol -notin @('Any', 'TCP', '6')) { continue }
    $ownProgram = $ruleProgram -ine 'Any' -and $ruleProgram -ieq $Program
    $exactAnyPort = $ruleProgram -ieq 'Any' -and (Test-ExactPort $portFilter.LocalPort $Port)
    if (($ownProgram -and (Test-PortCouldMatch $portFilter.LocalPort $Port)) -or $exactAnyPort) {
      $hits += $rule
    }
  }
  return $hits
}

try {
  $request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $action = [string]$request.action
  if ($action -notin @('ensure', 'remove', 'status')) { throw 'درخواست مدیریت فایروال معتبر نیست.' }

  $ruleName = [string]$request.ruleName
  if ($ruleName -notmatch '^PishkanLAN_[a-f0-9]{16}$') { throw 'شناسهٔ قانون فایروال معتبر نیست.' }
  $port = 0
  if (-not [int]::TryParse([string]$request.port, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
    throw 'شمارهٔ پورت LAN معتبر نیست.'
  }
  $program = [string]$request.program
  if (-not [IO.Path]::IsPathRooted($program) -or -not (Test-Path -LiteralPath $program -PathType Leaf)) {
    throw 'مسیر برنامهٔ Node.js معتبر نیست.'
  }
  $program = [IO.Path]::GetFullPath($program)

  $allRuleNames = @("$ruleName-LanAllow", "$ruleName-PrivateAllow", "$ruleName-PublicBlock")
  $own = Get-OwnRuleState $ruleName $port $program

  if ($action -eq 'remove') {
    $exists = $false
    foreach ($name in $allRuleNames) { if (Get-Rule $name) { $exists = $true } }
    if (-not $exists) {
      Write-Result @{ ok = $true; removed = $false; message = 'قانون فایروال این نصب وجود نداشت.' }
      exit 0
    }
    if (-not (Test-Administrator)) {
      throw 'برای حذف قانون LAN باید با دسترسی Administrator اجرا شود. خود برنامه در حالت loopback امن می‌ماند.'
    }
    foreach ($name in $allRuleNames) {
      Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    }
    Write-Result @{ ok = $true; removed = $true; message = 'قانون‌های فایروال LAN این نصب حذف شدند.' }
    exit 0
  }

  $profilesInfo = Get-FirewallProfilesInfo

  if ($action -eq 'status') {
    if ($profilesInfo.allOff) {
      Write-Result @{ ok = $true; configured = $own.configured; firewallOff = $true; profiles = $profilesInfo.profiles; message = 'فایروال Windows خاموش است؛ گوشی‌های همان شبکه بدون قانون هم می‌توانند وصل شوند.' }
      exit 0
    }
    $blockerNames = @((Find-BlockerRules $ruleName $port $program) | ForEach-Object { [string]$_.DisplayName })
    $ok = $own.configured -and @($blockerNames).Count -eq 0
    $message = if ($ok) { 'فایروال LAN آماده است؛ گوشی‌های همان Wi-Fi می‌توانند به این رایانه وصل شوند.' }
      elseif (@($blockerNames).Count -gt 0) { "یک قانون «مسدودکننده» جلوی اتصال گوشی را می‌گیرد: $($blockerNames -join '، '). در Pishkan Manager دکمهٔ «باز کردن فایروال برای موبایل» را بزنید تا خنثی شود." }
      elseif ($own.allowRule -or $own.legacyRules) { 'قانون فایروال LAN این نصب نیازمند به‌روزرسانی است؛ در Pishkan Manager دکمهٔ «باز کردن فایروال برای موبایل» را یک بار بزنید.' }
      else { 'قانون فایروال LAN هنوز ساخته نشده است؛ سرویس در حال اجراست، اما اگر گوشی وصل نشد در Pishkan Manager دکمهٔ «باز کردن فایروال برای موبایل» را بزنید.' }
    Write-Result @{ ok = $ok; configured = $own.configured; allowRule = $own.allowRule; blockers = @($blockerNames); profiles = $profilesInfo.profiles; message = $message }
    if ($ok) { exit 0 } else { exit 1 }
  }

  # ----- ensure -----
  if ($profilesInfo.allOff) {
    Write-Result @{ ok = $true; configured = $own.configured; created = $false; firewallOff = $true; profiles = $profilesInfo.profiles; message = 'فایروال Windows خاموش است و نیازی به ساخت قانون نیست؛ گوشی‌های همان شبکه می‌توانند وصل شوند.' }
    exit 0
  }

  $blockerRules = Find-BlockerRules $ruleName $port $program
  $needsWork = (-not $own.configured) -or $own.legacyRules -or @($blockerRules).Count -gt 0

  if (-not $needsWork) {
    Write-Result @{ ok = $true; configured = $true; created = $false; profiles = $profilesInfo.profiles; message = 'قانون LAN از قبل درست پیکربندی شده است.' }
    exit 0
  }
  if (-not (Test-Administrator)) {
    if ($own.configured) {
      throw 'قانون اجازه ساخته شده است، اما یک قانون مسدودکنندهٔ قدیمی باید با دسترسی Administrator خنثی شود؛ در Pishkan Manager دکمهٔ «باز کردن فایروال برای موبایل» را بزنید و تأیید Windows را قبول کنید.'
    }
    throw 'برای ساخت قانون LAN باید یک بار تأیید Administrator داده شود؛ در Pishkan Manager دکمهٔ «باز کردن فایروال برای موبایل» را بزنید و تأیید Windows را قبول کنید. سرویس بدون قانون هم در حال اجراست.'
  }

  foreach ($name in $allRuleNames) {
    Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  }

  New-NetFirewallRule -PolicyStore PersistentStore -Name "$ruleName-LanAllow" `
    -DisplayName 'Pishkan — دسترسی شبکهٔ محلی (موبایل)' -Group 'Pishkan LAN Access' -Enabled True `
    -Direction Inbound -Action Allow -Profile Domain,Private,Public -Protocol TCP -LocalPort $port `
    -RemoteAddress LocalSubnet -Program $program -EdgeTraversalPolicy Block | Out-Null

  $disabledBlockers = @()
  $stubbornBlockers = @()
  foreach ($rule in $blockerRules) {
    try {
      Disable-NetFirewallRule -Name $rule.Name -ErrorAction Stop
      $disabledBlockers += [string]$rule.DisplayName
    } catch {
      $stubbornBlockers += [string]$rule.DisplayName
    }
  }

  $verified = Get-OwnRuleState $ruleName $port $program
  if (-not $verified.configured) {
    Get-NetFirewallRule -PolicyStore PersistentStore -Name "$ruleName-LanAllow" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    throw 'راستی‌آزمایی قانون فایروال LAN ناموفق بود؛ قانون ساخته‌شده پاک شد.'
  }
  if (@($stubbornBlockers).Count -gt 0) {
    Write-Result @{ ok = $false; configured = $true; created = $true; disabledBlockers = @($disabledBlockers); blockers = @($stubbornBlockers); profiles = $profilesInfo.profiles; message = "قانون اجازه ساخته شد، اما این قانون‌های مسدودکننده (احتمالاً از Group Policy) خنثی نشدند و ممکن است جلوی اتصال گوشی را بگیرند: $($stubbornBlockers -join '، ')" }
    exit 1
  }

  $note = if (@($disabledBlockers).Count -gt 0) { " قانون مسدودکنندهٔ قدیمی هم خنثی شد: $($disabledBlockers -join '، ')." } else { '' }
  Write-Result @{ ok = $true; configured = $true; created = $true; disabledBlockers = @($disabledBlockers); profiles = $profilesInfo.profiles; message = "قانون LAN برای شبکهٔ محلی (همهٔ پروفایل‌ها، فقط LocalSubnet) ساخته شد؛ حالا گوشی روی همان Wi-Fi می‌تواند وصل شود.$note" }
  exit 0
} catch {
  try { Write-Result @{ ok = $false; configured = $false; message = [string]$_.Exception.Message } } catch { }
  exit 1
}
