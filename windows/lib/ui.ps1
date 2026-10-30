# Pishkan — shared WinForms UI kit (dark + light themes, RTL, Persian labels).
#
# Windows PowerShell 5.1 compatible: no ternary operator, no null-coalescing,
# no classes. Every control carries a colour role in its .Tag property so one
# function can re-paint the whole window when the theme is switched.
#
# Roles: form / panel / card / title / muted / accent / ok / warn / danger / border / input

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:PishkanPalettes = @{
  dark = @{
    form = '#0B1220'; panel = '#111A2B'; card = '#16213A'; border = '#22304A'
    title = '#E7EEF9'; text = '#D6E1F0'; muted = '#9FB0C9'; input = '#0E1728'
    accent = '#2F7BF6'; accentText = '#FFFFFF'; ok = '#35C48A'; warn = '#F2B340'
    danger = '#F0546A'; okBg = '#12301F'; dangerBg = '#33131A'; warnBg = '#33280F'
  }
  light = @{
    form = '#F6F8FC'; panel = '#FFFFFF'; card = '#FFFFFF'; border = '#DCE4F0'
    title = '#16213A'; text = '#243247'; muted = '#5B6B85'; input = '#FFFFFF'
    accent = '#1D5FD8'; accentText = '#FFFFFF'; ok = '#12805C'; warn = '#A86A05'
    danger = '#C22A3E'; okBg = '#E8F7F0'; dangerBg = '#FDECEF'; warnBg = '#FFF6E3'
  }
}

$script:ThemeMode = 'dark'
$script:Palette = $script:PishkanPalettes.dark

function Get-PishkanSettingsPath {
  $dir = Join-Path $env:APPDATA 'Pishkan'
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  return (Join-Path $dir 'ui-settings.json')
}

function Load-UiSettings {
  $path = Get-PishkanSettingsPath
  $settings = @{ theme = 'dark' }
  if (Test-Path $path) {
    try {
      $raw = Get-Content -Raw -Encoding UTF8 -Path $path | ConvertFrom-Json
      if ($raw.theme -eq 'light' -or $raw.theme -eq 'dark') { $settings.theme = $raw.theme }
    } catch { }
  }
  return $settings
}

function Save-UiSettings([hashtable]$Settings) {
  try {
    $Settings | ConvertTo-Json | Set-Content -Encoding UTF8 -Path (Get-PishkanSettingsPath)
  } catch { }
}

function Set-PishkanTheme([string]$Mode) {
  if ($Mode -ne 'light' -and $Mode -ne 'dark') { $Mode = 'dark' }
  $script:ThemeMode = $Mode
  $script:Palette = $script:PishkanPalettes[$Mode]
}

function Get-PishkanColor([string]$Role) {
  if ($script:Palette.ContainsKey($Role)) {
    return [System.Drawing.ColorTranslator]::FromHtml($script:Palette[$Role])
  }
  return [System.Drawing.ColorTranslator]::FromHtml($script:Palette['text'])
}

function Get-PishkanFont([single]$Size, [bool]$Bold = $false) {
  $style = [System.Drawing.FontStyle]::Regular
  if ($Bold) { $style = [System.Drawing.FontStyle]::Bold }
  return New-Object System.Drawing.Font('Segoe UI', $Size, $style)
}

function Set-ControlRole($Control, [string]$Role) {
  $Control.Tag = $Role
  return $Control
}

function New-PishkanLabel([string]$Text, [string]$Role, [single]$Size, [bool]$Bold) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.AutoSize = $false
  $label.Font = Get-PishkanFont $Size $Bold
  $label.Tag = $Role
  $label.BackColor = [System.Drawing.Color]::Transparent
  $label.Margin = New-Object System.Windows.Forms.Padding(0)
  return $label
}

function New-PishkanButton([string]$Text, [string]$Role, [int]$Width, [int]$Height) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Width = $Width
  $button.Height = $Height
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.Font = Get-PishkanFont 9.5 $true
  $button.Tag = $Role
  $button.Cursor = [System.Windows.Forms.Cursors]::Hand
  $button.UseVisualStyleBackColor = $false
  $button.FlatAppearance.BorderSize = 1
  return $button
}

function New-PishkanTextBox([string]$Text, [int]$Width, [switch]$Password) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Text = $Text
  $box.Width = $Width
  $box.Height = 28
  $box.Font = Get-PishkanFont 10 $false
  $box.Tag = 'input'
  $box.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  if ($Password) { $box.UseSystemPasswordChar = $true }
  return $box
}

function New-PishkanPanel([int]$Width, [int]$Height, [string]$Role) {
  $panel = New-Object System.Windows.Forms.Panel
  $panel.Width = $Width
  $panel.Height = $Height
  $panel.Tag = $Role
  return $panel
}

function New-PishkanProgress {
  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.Minimum = 0
  $bar.Maximum = 100
  $bar.Value = 0
  $bar.Height = 14
  $bar.Tag = 'progress'
  return $bar
}

function Update-PishkanProgressColor($Bar) {
  # WinForms ProgressBar ignores BackColor; the accent bar is emulated with a
  # coloured panel underneath the native bar in the installer, so nothing to do.
  return $Bar
}

<#
  Re-paint every control of a form according to its role. Called once after the
  layout is built and again whenever the theme is toggled.
#>
function Apply-PishkanTheme($Form) {
  $Form.BackColor = Get-PishkanColor 'form'
  foreach ($control in @($Form.Controls)) {
    Apply-PishkanControlTheme $control
  }
  $Form.Refresh()
}

function Apply-PishkanControlTheme($Control) {
  $role = $Control.Tag
  if ($role -isnot [string]) { $role = '' }
  $border = Get-PishkanColor 'border'

  if ($role -eq 'form') { $Control.BackColor = Get-PishkanColor 'form' }
  elseif ($role -eq 'panel') { $Control.BackColor = Get-PishkanColor 'panel' }
  elseif ($role -eq 'card') { $Control.BackColor = Get-PishkanColor 'card' }
  elseif ($role -eq 'muted') { $Control.BackColor = [System.Drawing.Color]::Transparent; $Control.ForeColor = Get-PishkanColor 'muted' }
  elseif ($role -eq 'title') { $Control.BackColor = [System.Drawing.Color]::Transparent; $Control.ForeColor = Get-PishkanColor 'title' }
  elseif ($role -eq 'text') { $Control.BackColor = [System.Drawing.Color]::Transparent; $Control.ForeColor = Get-PishkanColor 'text' }
  elseif ($role -eq 'ok') { $Control.BackColor = [System.Drawing.Color]::Transparent; $Control.ForeColor = Get-PishkanColor 'ok' }
  elseif ($role -eq 'warn') { $Control.BackColor = [System.Drawing.Color]::Transparent; $Control.ForeColor = Get-PishkanColor 'warn' }
  elseif ($role -eq 'danger') { $Control.BackColor = [System.Drawing.Color]::Transparent; $Control.ForeColor = Get-PishkanColor 'danger' }
  elseif ($role -eq 'input') {
    $Control.BackColor = Get-PishkanColor 'input'
    $Control.ForeColor = Get-PishkanColor 'text'
  }
  elseif ($role -eq 'accent') {
    $Control.BackColor = Get-PishkanColor 'accent'
    $Control.ForeColor = Get-PishkanColor 'accentText'
    if ($Control.PSObject.Properties.Match('FlatAppearance').Count -gt 0) {
      $Control.FlatAppearance.BorderColor = Get-PishkanColor 'accent'
    }
  }
  elseif ($role -eq 'ghost') {
    $Control.BackColor = Get-PishkanColor 'card'
    $Control.ForeColor = Get-PishkanColor 'text'
    if ($Control.PSObject.Properties.Match('FlatAppearance').Count -gt 0) {
      $Control.FlatAppearance.BorderColor = $border
    }
  }
  elseif ($role -eq 'log') {
    $Control.BackColor = Get-PishkanColor 'input'
    $Control.ForeColor = Get-PishkanColor 'muted'
  }
  elseif ($role -eq 'progress') {
    $Control.BackColor = Get-PishkanColor 'input'
  }
  elseif ($role -eq 'list') {
    $Control.BackColor = Get-PishkanColor 'card'
    $Control.ForeColor = Get-PishkanColor 'text'
  }
  elseif ($role -eq 'steplist') {
    $Control.BackColor = Get-PishkanColor 'panel'
    $Control.ForeColor = Get-PishkanColor 'text'
  }

  foreach ($child in @($Control.Controls)) {
    Apply-PishkanControlTheme $child
  }
}

function Show-PishkanMessage([string]$Title, [string]$Text, [string]$Kind = 'info') {
  $icon = [System.Windows.Forms.MessageBoxIcon]::Information
  if ($Kind -eq 'error') { $icon = [System.Windows.Forms.MessageBoxIcon]::Error }
  if ($Kind -eq 'warning') { $icon = [System.Windows.Forms.MessageBoxIcon]::Warning }
  [void][System.Windows.Forms.MessageBox]::Show($Text, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
}

function Get-RepositoryRoot {
  param([string]$Start)
  $dir = $Start
  if (-not $dir) { $dir = $PSScriptRoot }
  $current = (Resolve-Path $dir).Path
  for ($i = 0; $i -lt 5; $i++) {
    if (Test-Path (Join-Path $current 'package.json')) { return $current }
    $parent = Split-Path $current -Parent
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-NodeCommand {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Get-PishkanVersion {
  try {
    $manifest = Join-Path (Get-RepositoryRoot $PSScriptRoot) 'windows\manifest\windows.manifest.json'
    if (Test-Path $manifest) {
      return (Get-Content -Raw -Encoding UTF8 -Path $manifest | ConvertFrom-Json).appVersion
    }
  } catch { }
  return '1.2.0'
}

# --------------------------------------------------------------- error report
# A GUI must never die with a raw .NET message like
# "The property 'StandardInputEncoding' cannot be found on this object":
# the text goes to a log file and the user gets a Persian message with the
# exact next step. Register-PishkanErrorHandler hooks the WinForms message loop,
# so an exception inside a click handler is reported instead of silently
# closing the window.

function Write-PishkanGuiLog([string]$Root, [string]$Text) {
  try {
    $dir = Join-Path $Root '.data'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $line = "[{0}] {1}`r`n" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    Add-Content -Path (Join-Path $dir 'windows-gui-error.log') -Value $line -Encoding UTF8
    return (Join-Path $dir 'windows-gui-error.log')
  } catch {
    return ''
  }
}

function Handle-PishkanFatal($Exception, [string]$Root) {
  $message = ''
  $detail = ''
  try { $message = [string]$Exception.Message } catch { $message = [string]$Exception }
  try { $detail = [string]$Exception } catch { $detail = $message }

  $friendly = 'خطای غیرمنتظره در پنجره رخ داد. نصب انجام نشده است.'
  if ($message -match 'StandardInputEncoding|StandardOutputEncoding|StandardErrorEncoding') {
    $friendly = 'نسخهٔ .NET این ویندوز قدیمی‌تر از آن است که این نسخهٔ پنجره انتظار دارد. ' +
      'نسخهٔ اصلاح‌شدهٔ Pishkan را از GitHub دریافت کنید؛ نصب متنی (/console) روی همین ویندوز کار می‌کند.'
  } elseif ($message -match 'No such file|cannot find path|پیدا نشد') {
    $friendly = 'یکی از فایل‌های برنامه پیدا نشد. مطمئن شوید پوشهٔ Pishkan کامل کپی شده است.'
  }

  $logPath = Write-PishkanGuiLog $Root ("FATAL: " + $detail)
  $body = $friendly + "`n`n" + $message
  if ($logPath) { $body += "`n`nگزارش کامل: " + $logPath }
  $body += "`n`nجایگزین بدون پنجره:  PishkanSetup.cmd /console"
  Show-PishkanMessage 'خطای غیرمنتظره' $body 'error'
}

function Register-PishkanErrorHandler([string]$Root) {
  try {
    [System.Windows.Forms.Application]::add_ThreadException({
      param($sender, $eventArgs)
      try { Handle-PishkanFatal $eventArgs.Exception $Root } catch { }
    })
  } catch { }
  try {
    [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
  } catch { }
}
