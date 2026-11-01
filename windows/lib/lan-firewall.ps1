param(
  [Parameter(Mandatory = $true)][string]$RequestFile,
  [Parameter(Mandatory = $true)][string]$ResultFile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

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

function Test-ProfileValue($Profile, [string]$Expected) {
  $values = @(([string]$Profile) -split '[,; ]+' | Where-Object { $_ })
  return (Test-ContainsValue $values $Expected) -or (Test-ContainsValue $values 'Any')
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

function Get-FirewallSafety {
  $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -Profile Domain,Private,Public)
  $names = @($profiles | ForEach-Object { [string]$_.Name })
  $requiredProfiles = @('Domain', 'Private', 'Public')
  $missingProfiles = @($requiredProfiles | Where-Object { $names -notcontains $_ })
  $allProfilesPresent = $missingProfiles.Count -eq 0
  $unsafe = @($profiles | Where-Object {
    ([string]$_.Enabled -notin @('True', '1')) -or ([string]$_.DefaultInboundAction -ne 'Block')
  })
  return @{
    safe = $allProfilesPresent -and $unsafe.Count -eq 0
    profiles = @($profiles | ForEach-Object { @{
      name = [string]$_.Name
      enabled = ([string]$_.Enabled -in @('True', '1'))
      defaultInboundAction = [string]$_.DefaultInboundAction
    } })
  }
}

function Get-Rule([string]$Name) {
  return Get-NetFirewallRule -PolicyStore PersistentStore -Name $Name -ErrorAction SilentlyContinue
}

function Test-ExactProfileSet($Profile, [string]$Expected) {
  $actual = @(([string]$Profile -split '[,; ]+' | Where-Object { $_ }) | ForEach-Object { ([string]$_).Trim() })
  $required = @($Expected -split '[,; ]+' | Where-Object { $_ })
  if ($actual.Count -ne $required.Count) { return $false }
  foreach ($value in $required) {
    if (-not (Test-ContainsValue $actual $value)) { return $false }
  }
  return $true
}

function Test-RuleShape($Rule, [string]$Action, [string]$Profile, [int]$Port, [string]$Program, [string]$RemoteAddress) {
  if (-not $Rule) { return $false }
  if ([string]$Rule.Enabled -notin @('True', '1')) { return $false }
  if ([string]$Rule.Direction -ne 'Inbound' -or [string]$Rule.Action -ne $Action) { return $false }
  if (-not (Test-ExactProfileSet $Rule.Profile $Profile)) { return $false }
  if ([string]$Rule.EdgeTraversalPolicy -ne 'Block') { return $false }

  $portFilter = $Rule | Get-NetFirewallPortFilter
  if ([string]$portFilter.Protocol -notin @('TCP', '6')) { return $false }
  if (-not (Test-ExactPort $portFilter.LocalPort $Port)) { return $false }

  $appFilter = $Rule | Get-NetFirewallApplicationFilter
  if ([string]$appFilter.Program -ine $Program) { return $false }

  $addressFilter = $Rule | Get-NetFirewallAddressFilter
  if (-not (Test-ExactValueSet $addressFilter.RemoteAddress $RemoteAddress)) { return $false }
  return $true
}

function Find-BroadAllowRule([string]$RuleName, [int]$Port, [string]$Program) {
  $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound -Action Allow -ErrorAction Stop)
  foreach ($rule in $rules) {
    if ([string]$rule.Name -like "$RuleName-*") { continue }
    if (-not (Test-ProfileValue $rule.Profile 'Private')) { continue }

    $appFilter = $rule | Get-NetFirewallApplicationFilter
    $ruleProgram = [string]$appFilter.Program
    if ($ruleProgram -ine 'Any' -and $ruleProgram -ine $Program) { continue }

    $portFilter = $rule | Get-NetFirewallPortFilter
    if ([string]$portFilter.Protocol -notin @('Any', 'TCP', '6')) { continue }
    if (-not (Test-PortCouldMatch $portFilter.LocalPort $Port)) { continue }

    $addressFilter = $rule | Get-NetFirewallAddressFilter
    $remote = @($addressFilter.RemoteAddress | ForEach-Object { [string]$_ })
    if ($remote.Count -eq 1 -and $remote[0] -ieq 'LocalSubnet') { continue }
    return [string]$rule.DisplayName
  }
  return $null
}

function Get-OwnRuleState([string]$RuleName, [int]$Port, [string]$Program) {
  $allow = Get-Rule "$RuleName-PrivateAllow"
  $block = Get-Rule "$RuleName-PublicBlock"
  $allowOk = Test-RuleShape $allow 'Allow' 'Private' $Port $Program 'LocalSubnet'
  $blockOk = Test-RuleShape $block 'Block' 'Public,Domain' $Port $Program 'Any'
  return @{
    configured = $allowOk -and $blockOk
    allowRule = [bool]$allow
    publicBlockRule = [bool]$block
    allowRuleValid = $allowOk
    publicBlockRuleValid = $blockOk
  }
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

  $own = Get-OwnRuleState $ruleName $port $program

  if ($action -eq 'remove') {
    if (-not $own.allowRule -and -not $own.publicBlockRule) {
      Write-Result @{ ok = $true; removed = $false; message = 'قانون فایروال این نصب وجود نداشت.' }
      exit 0
    }
    if (-not (Test-Administrator)) {
      throw 'برای حذف قانون LAN باید PishkanSetup.cmd را با دسترسی Administrator اجرا کنید. خود برنامه در حالت loopback امن می‌ماند.'
    }
    foreach ($name in @("$ruleName-PrivateAllow", "$ruleName-PublicBlock")) {
      Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    }
    Write-Result @{ ok = $true; removed = $true; message = 'قانون‌های فایروال LAN این نصب حذف شدند.' }
    exit 0
  }

  $safety = Get-FirewallSafety
  $conflict = Find-BroadAllowRule $ruleName $port $program

  if ($action -eq 'status') {
    $safe = $safety.safe -and -not $conflict -and $own.configured
    $message = if ($safe) { 'فایروال LAN فقط برای Private و LocalSubnet آماده است.' }
      elseif ($conflict) { "قانون ورودی گستردهٔ دیگری تداخل دارد: $conflict" }
      elseif (-not $safety.safe) { 'پروفایل‌های فایروال باید روشن باشند و ورودی پیش‌فرض آن‌ها مسدود بماند.' }
      else { 'قانون محدود فایروال LAN نصب نیست یا با تنظیم فعلی هم‌خوانی ندارد.' }
    Write-Result @{ ok = $safe; configured = $own.configured; safe = $safety.safe; conflict = $conflict; allowRule = $own.allowRule; publicBlockRule = $own.publicBlockRule; profiles = $safety.profiles; message = $message }
    if ($safe) { exit 0 } else { exit 1 }
  }

  if (-not $safety.safe) { throw 'برای فعال‌کردن LAN، فایروال Windows باید در هر سه پروفایل روشن و ورودی پیش‌فرض مسدود باشد؛ تنظیم عمومی فایروال تغییر داده نشد.' }
  if ($conflict) { throw "قانون ورودی گستردهٔ دیگری برای این پورت/Node پیدا شد: $conflict. ابتدا آن را محدود یا حذف کنید؛ قانون عمومی ساخته نشد." }
  if ($own.configured) {
    Write-Result @{ ok = $true; configured = $true; created = $false; profiles = $safety.profiles; message = 'قانون محدود LAN از قبل درست پیکربندی شده است.' }
    exit 0
  }
  if (-not (Test-Administrator)) {
    throw 'برای ساخت قانون محدود LAN، نصب‌کننده را با کلیک راست و گزینهٔ «Run as administrator» اجرا کنید؛ دسترسی LAN پیش‌فرض خاموش می‌ماند.'
  }

  foreach ($name in @("$ruleName-PrivateAllow", "$ruleName-PublicBlock")) {
    Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  }

  $group = 'Pishkan Private LAN Access'
  New-NetFirewallRule -PolicyStore PersistentStore -Name "$ruleName-PrivateAllow" `
    -DisplayName 'Pishkan — شبکه خصوصی محلی' -Group $group -Enabled True -Direction Inbound -Action Allow `
    -Profile Private -Protocol TCP -LocalPort $port -RemoteAddress LocalSubnet -Program $program `
    -EdgeTraversalPolicy Block | Out-Null
  New-NetFirewallRule -PolicyStore PersistentStore -Name "$ruleName-PublicBlock" `
    -DisplayName 'Pishkan — مسدود در شبکه عمومی/دامنه' -Group $group -Enabled True -Direction Inbound -Action Block `
    -Profile Public,Domain -Protocol TCP -LocalPort $port -RemoteAddress Any -Program $program `
    -EdgeTraversalPolicy Block | Out-Null

  $verified = Get-OwnRuleState $ruleName $port $program
  $postConflict = Find-BroadAllowRule $ruleName $port $program
  if (-not $verified.configured -or $postConflict) {
    foreach ($name in @("$ruleName-PrivateAllow", "$ruleName-PublicBlock")) {
      Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    }
    throw 'راستی‌آزمایی قانون‌های فایروال LAN ناموفق بود؛ قانون‌های این نصب پاک شدند.'
  }

  Write-Result @{ ok = $true; configured = $true; created = $true; profiles = $safety.profiles; message = 'قانون LAN فقط برای شبکهٔ Private و LocalSubnet ساخته شد؛ Public/Domain صریحاً مسدود است.' }
  exit 0
} catch {
  try { Write-Result @{ ok = $false; configured = $false; message = [string]$_.Exception.Message } } catch { }
  exit 1
}
