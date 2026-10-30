# Pishkan — graphical installer (WinForms).
#
# Launched by windows\PishkanSetup.cmd (double click). The window only draws and
# collects input; every installation step runs in windows/lib/installer.mjs so
# the same code is covered by the automated tests on Linux.
#
# The admin password is written to the child process' stdin and nowhere else:
# it is not in the command line, not in an environment variable and not in a
# temporary file.

param(
  [string]$Root = '',
  [int]$Port = 3000,
  [string]$Theme = '',
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ui.ps1')
. (Join-Path $PSScriptRoot 'prereq.ps1')

$settings = Load-UiSettings
if ($Theme) { Set-PishkanTheme $Theme } else { Set-PishkanTheme $settings.theme }

$RepoRoot = Get-RepositoryRoot (Get-Location).Path
if ($Root) { $RepoRoot = (Resolve-Path $Root).Path }
$Version = Get-PishkanVersion
$script:Installing = $false
$script:Finished = $false
$script:Steps = New-Object System.Collections.ArrayList
$script:LastResult = $null

# ------------------------------------------------------------------ window 

$form = New-Object System.Windows.Forms.Form
$form.Text = "نصب Pishkan $Version"
$form.Width = 1060
$form.Height = 720
$form.MinimumSize = New-Object System.Drawing.Size(1060, 720)
$form.StartPosition = 'CenterScreen'
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = Get-PishkanFont 10 $false
$form.Tag = 'form'

# ---------------------------------------------------------------- brand bar

$brand = New-PishkanPanel 1040 96 'panel'
$brand.Location = New-Object System.Drawing.Point(0, 0)
$form.Controls.Add($brand)

$logo = New-PishkanPanel 56 56 'accent'
$logo.Location = New-Object System.Drawing.Point(962, 20)
$brand.Controls.Add($logo)
$logoLabel = New-PishkanLabel 'پ' 'accent' 24 $true
$logoLabel.AutoSize = $false
$logoLabel.TextAlign = 'MiddleCenter'
$logoLabel.Dock = 'Fill'
$logo.Controls.Add($logoLabel)

$brandTitle = New-PishkanLabel 'نصب Pishkan روی ویندوز' 'title' 18 $true
$brandTitle.Location = New-Object System.Drawing.Point(560, 20)
$brandTitle.Size = New-Object System.Drawing.Size(390, 34)
$brandTitle.TextAlign = 'MiddleRight'
$brand.Controls.Add($brandTitle)

$brandSub = New-PishkanLabel "نسخه $Version · نصب محلی، پایگاه داده SQLite، بدون اتصال به سامانه اصلی" 'muted' 10 $false
$brandSub.Location = New-Object System.Drawing.Point(360, 56)
$brandSub.Size = New-Object System.Drawing.Size(590, 24)
$brandSub.TextAlign = 'MiddleRight'
$brand.Controls.Add($brandSub)

$themeButton = New-PishkanButton 'تغییر تم' 'ghost' 110 32
$themeButton.Location = New-Object System.Drawing.Point(30, 32)
$brand.Controls.Add($themeButton)

# ----------------------------------------------------------------- sidebar

$sidebar = New-PishkanPanel 300 480 'panel'
$sidebar.Location = New-Object System.Drawing.Point(740, 96)
$form.Controls.Add($sidebar)

$stepsTitle = New-PishkanLabel 'مراحل نصب' 'muted' 10 $true
$stepsTitle.Location = New-Object System.Drawing.Point(24, 18)
$stepsTitle.Size = New-Object System.Drawing.Size(250, 24)
$sidebar.Controls.Add($stepsTitle)

$script:StepLabels = @{}
$stepDefs = @(
  @{ id = 'check'; text = '۱. بررسی سیستم' },
  @{ id = 'env'; text = '۲. تنظیمات محلی' },
  @{ id = 'deps'; text = '۳. دانلود وابستگی‌ها' },
  @{ id = 'build'; text = '۴. ساخت برنامه' },
  @{ id = 'database'; text = '۵. پایگاه داده و مهاجرت' },
  @{ id = 'admin'; text = '۶. حساب مدیر کل' },
  @{ id = 'start'; text = '۷. راه‌اندازی سرویس' },
  @{ id = 'verify'; text = '۸. آزمون نهایی' }
)
$offset = 52
foreach ($def in $stepDefs) {
  $lbl = New-PishkanLabel ("○  " + $def.text) 'muted' 10 $false
  $lbl.Location = New-Object System.Drawing.Point(24, $offset)
  $lbl.Size = New-Object System.Drawing.Size(250, 26)
  $lbl.TextAlign = 'MiddleRight'
  $sidebar.Controls.Add($lbl)
  $script:StepLabels[$def.id] = $lbl
  $offset += 32
}

$sidebarHint = New-PishkanLabel "پوشه برنامه:`n$RepoRoot" 'muted' 9 $false
$sidebarHint.Location = New-Object System.Drawing.Point(24, 330)
$sidebarHint.Size = New-Object System.Drawing.Size(250, 120)
$sidebarHint.TextAlign = 'TopRight'
$sidebar.Controls.Add($sidebarHint)

# ------------------------------------------------------------ page: config

$pageConfig = New-PishkanPanel 720 480 'card'
$pageConfig.Location = New-Object System.Drawing.Point(20, 108)
$form.Controls.Add($pageConfig)

function New-Field([string]$Label, [int]$Top, $Control) {
  $lbl = New-PishkanLabel $Label 'muted' 9.5 $false
  $lbl.Location = New-Object System.Drawing.Point(400, $Top)
  $lbl.Size = New-Object System.Drawing.Size(280, 22)
  $lbl.TextAlign = 'MiddleRight'
  $pageConfig.Controls.Add($lbl)
  $Control.Location = New-Object System.Drawing.Point(80, ($Top + 24))
  $pageConfig.Controls.Add($Control)
  return $Control
}

$pathBox = New-PishkanTextBox $RepoRoot 600
[void](New-Field 'مسیر نصب (همان پوشه پروژه؛ پوشه داده و تنظیمات داخل آن ساخته می‌شود)' 10 $pathBox)

$portBox = New-Object System.Windows.Forms.NumericUpDown
$portBox.Minimum = 1024
$portBox.Maximum = 65000
$portBox.Value = $Port
$portBox.Width = 140
$portBox.Font = Get-PishkanFont 10 $false
$portBox.Tag = 'input'
[void](New-Field 'پورت برنامه (پیش‌فرض ۳۰۰۰)' 78 $portBox)

$nameBox = New-PishkanTextBox 'مدیر کل محلی' 600
[void](New-Field 'نام و نام خانوادگی مدیر کل' 146 $nameBox)

$userBox = New-PishkanTextBox 'admin' 600
[void](New-Field 'نام کاربری مدیر کل (حروف انگلیسی، رقم، نقطه، خط تیره)' 214 $userBox)

$passBox = New-PishkanTextBox '' 600 -Password
[void](New-Field 'رمز عبور (حداقل ۱۰ کاراکتر، ترکیب حرف و رقم)' 282 $passBox)

$pass2Box = New-PishkanTextBox '' 600 -Password
[void](New-Field 'تکرار رمز عبور' 350 $pass2Box)

$checkButton = New-PishkanButton 'بررسی سیستم' 'ghost' 150 38
$checkButton.Location = New-Object System.Drawing.Point(520, 424)
$pageConfig.Controls.Add($checkButton)

$nodeButton = New-PishkanButton 'نصب Node.js' 'ghost' 150 38
$nodeButton.Location = New-Object System.Drawing.Point(660, 424)
$nodeButton.Visible = $false
$pageConfig.Controls.Add($nodeButton)

$startButton = New-PishkanButton 'شروع نصب' 'accent' 190 40
$startButton.Location = New-Object System.Drawing.Point(310, 424)
$pageConfig.Controls.Add($startButton)

$configStatus = New-PishkanLabel 'برای شروع، مسیر و اطلاعات مدیر کل را بررسی کنید.' 'muted' 9.5 $false
$configStatus.Location = New-Object System.Drawing.Point(60, 424)
$configStatus.Size = New-Object System.Drawing.Size(230, 40)
$configStatus.TextAlign = 'MiddleRight'
$pageConfig.Controls.Add($configStatus)

# ---------------------------------------------------------- page: progress

$pageProgress = New-PishkanPanel 720 480 'card'
$pageProgress.Location = New-Object System.Drawing.Point(20, 108)
$pageProgress.Visible = $false
$form.Controls.Add($pageProgress)

$progressTitle = New-PishkanLabel 'در حال نصب…' 'title' 14 $true
$progressTitle.Location = New-Object System.Drawing.Point(60, 18)
$progressTitle.Size = New-Object System.Drawing.Size(620, 30)
$progressTitle.TextAlign = 'MiddleRight'
$pageProgress.Controls.Add($progressTitle)

$progressBar = New-PishkanProgress
$progressBar.Location = New-Object System.Drawing.Point(60, 58)
$progressBar.Width = 620
$pageProgress.Controls.Add($progressBar)

$progressDetail = New-PishkanLabel '' 'muted' 9.5 $false
$progressDetail.Location = New-Object System.Drawing.Point(60, 78)
$progressDetail.Size = New-Object System.Drawing.Size(620, 24)
$progressDetail.TextAlign = 'MiddleRight'
$pageProgress.Controls.Add($progressDetail)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.WordWrap = $false
$logBox.Location = New-Object System.Drawing.Point(60, 108)
$logBox.Size = New-Object System.Drawing.Size(620, 300)
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$logBox.Tag = 'log'
$pageProgress.Controls.Add($logBox)

$detailButton = New-PishkanButton 'نمایش/پنهان جزئیات فنی' 'ghost' 190 32
$detailButton.Location = New-Object System.Drawing.Point(490, 418)
$pageProgress.Controls.Add($detailButton)

# ------------------------------------------------------------ page: finish

$pageFinish = New-PishkanPanel 720 480 'card'
$pageFinish.Location = New-Object System.Drawing.Point(20, 108)
$pageFinish.Visible = $false
$form.Controls.Add($pageFinish)

$finishTitle = New-PishkanLabel 'نصب کامل شد' 'title' 16 $true
$finishTitle.Location = New-Object System.Drawing.Point(60, 20)
$finishTitle.Size = New-Object System.Drawing.Size(620, 34)
$finishTitle.TextAlign = 'MiddleRight'
$pageFinish.Controls.Add($finishTitle)

$finishSummary = New-PishkanLabel '' 'text' 10 $false
$finishSummary.Location = New-Object System.Drawing.Point(60, 64)
$finishSummary.Size = New-Object System.Drawing.Size(620, 200)
$finishSummary.TextAlign = 'TopRight'
$pageFinish.Controls.Add($finishSummary)

$openButton = New-PishkanButton 'باز کردن Pishkan' 'accent' 190 40
$openButton.Location = New-Object System.Drawing.Point(490, 400)
$pageFinish.Controls.Add($openButton)

$dataButton = New-PishkanButton 'پوشه داده' 'ghost' 150 40
$dataButton.Location = New-Object System.Drawing.Point(330, 400)
$pageFinish.Controls.Add($dataButton)

$closeButton = New-PishkanButton 'بستن' 'ghost' 120 40
$closeButton.Location = New-Object System.Drawing.Point(200, 400)
$pageFinish.Controls.Add($closeButton)

# ------------------------------------------------------------ bottom status

$footer = New-PishkanPanel 1040 44 'form'
$footer.Location = New-Object System.Drawing.Point(0, 596)
$form.Controls.Add($footer)

$footerText = New-PishkanLabel 'Pishkan — سامانه خدمات؛ نصب محلی برای آزمون. داده‌های واقعی وارد نکنید.' 'muted' 9 $false
$footerText.Location = New-Object System.Drawing.Point(20, 10)
$footerText.Size = New-Object System.Drawing.Size(700, 24)
$footerText.TextAlign = 'MiddleRight'
$footer.Controls.Add($footerText)

# ------------------------------------------------------------------ helpers

function Update-StepLabel([string]$Id, [string]$Status, [string]$Text) {
  if (-not $script:StepLabels.ContainsKey($Id)) { return }
  $label = $script:StepLabels[$Id]
  $prefix = '○'
  $role = 'muted'
  if ($Status -eq 'running') { $prefix = '◐'; $role = 'warn' }
  if ($Status -eq 'ok') { $prefix = '●'; $role = 'ok' }
  if ($Status -eq 'fail') { $prefix = '✕'; $role = 'danger' }
  if ($Status -eq 'skip') { $prefix = '–'; $role = 'muted' }
  $label.Text = "$prefix  $Text"
  $label.Tag = $role
  $label.ForeColor = Get-PishkanColor $role
}

function Append-Log([string]$Text) {
  $stamp = (Get-Date).ToString('HH:mm:ss')
  $logBox.AppendText("[$stamp] $Text`r`n")
}

function Set-Footer([string]$Text, [string]$Role = 'muted') {
  $footerText.Text = $Text
  $footerText.ForeColor = Get-PishkanColor $role
}

function Show-Page([string]$Name) {
  $pageConfig.Visible = ($Name -eq 'config')
  $pageProgress.Visible = ($Name -eq 'progress')
  $pageFinish.Visible = ($Name -eq 'finish')
}

function Test-FormInput {
  if (-not (Test-Path $pathBox.Text)) {
    Show-PishkanMessage 'مسیر نامعتبر' 'پوشه نصب پیدا نشد. مسیر پروژه Pishkan را انتخاب کنید.' 'warning'
    return $false
  }
  if (-not (Test-Path (Join-Path $pathBox.Text 'package.json'))) {
    Show-PishkanMessage 'مسیر نامعتبر' 'در این مسیر فایل package.json پیدا نشد؛ پوشه پروژه Pishkan را انتخاب کنید.' 'warning'
    return $false
  }
  if ($userBox.Text.Trim() -notmatch '^[a-zA-Z0-9._-]{3,60}$') {
    Show-PishkanMessage 'نام کاربری نامعتبر' 'نام کاربری باید ۳ تا ۶۰ کاراکتر و شامل حروف انگلیسی، رقم، نقطه، زیرخط یا خط تیره باشد.' 'warning'
    return $false
  }
  if ($nameBox.Text.Trim().Length -lt 3) {
    Show-PishkanMessage 'نام نامعتبر' 'نام و نام خانوادگی مدیر کل را کامل وارد کنید.' 'warning'
    return $false
  }
  if ($passBox.Text.Length -lt 10) {
    Show-PishkanMessage 'رمز عبور کوتاه' 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.' 'warning'
    return $false
  }
  if (($passBox.Text -notmatch '[A-Za-z\u0600-\u06FF]') -or ($passBox.Text -notmatch '\d')) {
    Show-PishkanMessage 'رمز عبور ضعیف' 'رمز عبور باید ترکیبی از حرف و رقم باشد.' 'warning'
    return $false
  }
  if ($passBox.Text -ne $pass2Box.Text) {
    Show-PishkanMessage 'رمز عبور یکسان نیست' 'رمز عبور و تکرار آن یکسان نیستند.' 'warning'
    return $false
  }
  return $true
}

function Start-BackgroundProcess([string]$FileName, [string]$Arguments, [string]$WorkingDirectory) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $FileName
  $info.Arguments = $Arguments
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $info.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  # UTF8 without BOM: a BOM would corrupt the single JSON line sent on stdin.
  $info.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false)
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  [void]$process.Start()
  return $process
}

# --------------------------------------------------------------- system check

function Invoke-SystemCheck {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Show-PishkanMessage 'Node.js پیدا نشد' ('برای اجرای Pishkan، Node.js نسخه 22.22.2 یا جدیدتر لازم است.' + "`n`n" + 'دکمهٔ «نصب Node.js» را بزنید؛ نصب‌کننده آن را با winget و در صورت نبود آن با نصب‌کنندهٔ رسمی nodejs.org (با بررسی SHA-256) نصب می‌کند.') 'warning'
    return $false
  }
  $process = Start-BackgroundProcess $node.Source ("`"" + (Join-Path $RepoRoot 'windows\lib\syscheck.mjs') + "`" --root `"" + $pathBox.Text + "`" --port " + $portBox.Value) $RepoRoot
  $process.StandardInput.Close()
  $output = $process.StandardOutput.ReadToEnd()
  $process.WaitForExit(60000) | Out-Null
  $line = ($output -split "`n" | Where-Object { $_ -like 'RESULT_JSON:*' } | Select-Object -First 1)
  if (-not $line) {
    Show-PishkanMessage 'بررسی سیستم' 'خروجی بررسی سیستم خوانده نشد.' 'error'
    return $false
  }
  $report = ($line.Substring(12) | ConvertFrom-Json)
  $problems = @()
  foreach ($item in $report.items) {
    Append-Log ("{0} — {1}" -f $item.title, $item.detail)
    if ($item.status -eq 'fail') { $problems += ("{0}: {1} {2}" -f $item.title, $item.detail, $item.remediation) }
  }
  if ($problems.Count -gt 0) {
    Show-PishkanMessage 'بررسی سیستم' (($problems -join "`n`n") + "`n`nتا رفع این موارد، نصب ادامه پیدا نمی‌کند.") 'error'
    return $false
  }
  $configStatus.Text = "بررسی سیستم موفق بود.`nNode $($report.node) · فضای آزاد $($report.freeMb) MB"
  $configStatus.Tag = 'ok'
  $configStatus.ForeColor = Get-PishkanColor 'ok'
  Update-StepLabel 'check' 'ok' '۱. بررسی سیستم'
  return $true
}

# ----------------------------------------------------------------- installation

function Start-Installation {
  if (-not (Test-FormInput)) { return }
  $nodeCommand = Get-NodeCommand
  if (-not $nodeCommand) {
    Show-PishkanMessage 'Node.js لازم است' 'Node.js پیدا نشد. ابتدا «بررسی سیستم» را اجرا کنید و پیش‌نیازها را نصب کنید.' 'error'
    return
  }

  $script:Installing = $true
  Show-Page 'progress'
  $startButton.Enabled = $false
  $checkButton.Enabled = $false
  $progressBar.Value = 0
  $progressTitle.Text = 'در حال نصب…'
  $logBox.Clear()
  Append-Log "نصب در مسیر $($pathBox.Text) آغاز شد"

  $job = @{
    port = [int]$portBox.Value
    admin = @{
      fullName = $nameBox.Text.Trim()
      username = $userBox.Text.Trim()
      password = $passBox.Text
    }
  } | ConvertTo-Json -Depth 4

  $installer = Join-Path $RepoRoot 'windows\lib\installer.mjs'
  $process = Start-BackgroundProcess $nodeCommand ("`"" + $installer + "`" --root `"" + $pathBox.Text + "`" --json-lines --job-stdin") $pathBox.Text
  $process.StandardInput.WriteLine($job)
  $process.StandardInput.Close()
  $passBox.Text = ''
  $pass2Box.Text = ''

  $pending = $process.StandardOutput.ReadLineAsync()
  while ($true) {
    if ($null -eq $pending) { break }
    if ($pending.IsCompleted) {
      $line = $null
      try { $line = $pending.Result } catch { $line = $null }
      if ($null -eq $line) { break }
      Handle-InstallerLine $line
      $pending = $process.StandardOutput.ReadLineAsync()
    } else {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 60
    }
  }
  $waitDeadline = (Get-Date).AddSeconds(20)
  while (-not $process.HasExited -and (Get-Date) -lt $waitDeadline) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 60
  }
  $stderr = ''
  try { $stderr = $process.StandardError.ReadToEnd() } catch { }
  if ($stderr) { Append-Log ("stderr: " + $stderr.Trim()) }

  $script:Installing = $false
  Show-InstallResult ($process.ExitCode -eq 0)
}

function Handle-InstallerLine([string]$Line) {
  if (-not $Line.Trim()) { return }
  $event = $null
  try { $event = $Line | ConvertFrom-Json } catch { Append-Log $Line; return }
  if ($event.type -eq 'step') {
    $progressBar.Value = [int][Math]::Min([double]100, [Math]::Max([double]0, [double]$event.progress))
    $progressTitle.Text = $event.title
    $progressDetail.Text = $event.message
    Update-StepLabel $event.id $event.status $event.title
    if ($event.status -ne 'running') { Append-Log ("{0} — {1}" -f $event.title, $event.message) }
    Set-Footer $event.message 'muted'
  } elseif ($event.type -eq 'log') {
    Append-Log $event.message
  } elseif ($event.type -eq 'retry') {
    Append-Log ("تلاش دوباره {0}/{1} تا {2} ثانیه دیگر" -f $event.attempt, $event.attempts, ([int]$event.waitMs / 1000))
  } elseif ($event.type -eq 'result') {
    $script:LastResult = $event
  }
}

function Show-InstallResult([bool]$Ok) {
  if (-not $Ok) {
    Show-Page 'progress'
    $progressTitle.Text = 'نصب کامل نشد'
    $progressTitle.Tag = 'danger'
    $progressTitle.ForeColor = Get-PishkanColor 'danger'
    $progressDetail.Text = 'دلیل خطا در گزارش خطا ثبت شد؛ هیچ بخشی از نصب موفق اعلام نمی‌شود.'
    $detailButton.Enabled = $true
    Set-Footer 'نصب ناموفق بود — گزارش خطا را ببینید' 'danger'
    $script:Finished = $true
    Show-PishkanMessage 'نصب ناموفق بود' ("نصب کامل نشد.`n`n" + (Get-ErrorMessage) + "`n`nپرونده گزارش: " + (Join-Path $pathBox.Text '.data\install-error.json')) 'error'
    return
  }
  Show-Page 'finish'
  $script:Finished = $true
  $url = "http://127.0.0.1:$($portBox.Value)"
  $report = $script:LastResult.report
  if ($report -and $report.url) { $url = $report.url }
  $finishSummary.Text = ("نصب با موفقیت انجام شد.`n`n" +
    "آدرس برنامه: $url`n`n" +
    "نام کاربری مدیر کل: $($userBox.Text.Trim())`n" +
    "پوشه داده: " + (Join-Path $pathBox.Text '.data') + "`n`n" +
    "برای اتصال دوباره از «Pishkan Manager» استفاده کنید. گزارش نصب در .data\install-report.json ذخیره شد.")
  $finishSummary.Tag = 'text'
  $finishSummary.ForeColor = Get-PishkanColor 'text'
  $script:AppUrl = $url
  Set-Footer 'نصب با موفقیت پایان یافت' 'ok'
}

function Get-ErrorMessage {
  $file = Join-Path $pathBox.Text '.data\install-error.json'
  if (Test-Path $file) {
    try {
      $errorReport = Get-Content -Raw -Encoding UTF8 -Path $file | ConvertFrom-Json
      return [string]$errorReport.message
    } catch { }
  }
  return 'جزئیات خطا در دسترس نیست.'
}

# ------------------------------------------------------------------ wiring

$themeButton.Add_Click({
  if ($script:ThemeMode -eq 'dark') { Set-PishkanTheme 'light' } else { Set-PishkanTheme 'dark' }
  $settings.theme = $script:ThemeMode
  Save-UiSettings $settings
  Apply-PishkanTheme $form
})

$checkButton.Add_Click({
  try { [void](Invoke-SystemCheck) } catch { Show-PishkanMessage 'خطا در بررسی سیستم' $_.Exception.Message 'error' }
})

$nodeButton.Add_Click({
  $nodeButton.Enabled = $false
  Set-Footer 'در حال نصب Node.js — این کار ممکن است چند دقیقه طول بکشد…' 'warn'
  [System.Windows.Forms.Application]::DoEvents()
  try {
    $result = Install-NodeRuntime
    Append-Log $result.message
    if ($result.ok) {
      Show-PishkanMessage 'پیش‌نیاز نصب شد' ($result.message + "`n`nاکنون «بررسی سیستم» را اجرا کنید.") 'info'
      $nodeButton.Visible = $false
      Set-Footer 'Node.js نصب شد.' 'ok'
    } else {
      Show-PishkanMessage 'نصب پیش‌نیاز ناموفق بود' ($result.message + "`n`nمی‌توانید Node.js را دستی از nodejs.org نصب کنید.") 'error'
      Set-Footer 'نصب Node.js ناموفق بود' 'danger'
    }
  } catch {
    Show-PishkanMessage 'خطا' $_.Exception.Message 'error'
  } finally {
    $nodeButton.Enabled = $true
  }
})

$startButton.Add_Click({
  try {
    if (-not $SkipChecks) {
      $ok = Invoke-SystemCheck
      if (-not $ok) { return }
    }
    Start-Installation
  } catch {
    $script:Installing = $false
    Show-PishkanMessage 'خطای نصب‌کننده' $_.Exception.Message 'error'
  }
})

$detailButton.Add_Click({ $logBox.Visible = -not $logBox.Visible })

$openButton.Add_Click({ Start-Process $script:AppUrl })

$dataButton.Add_Click({ Start-Process (Join-Path $pathBox.Text '.data') })

$closeButton.Add_Click({ $form.Close() })

$form.Add_FormClosing({
  param($sender, $event)
  if ($script:Installing) {
    $event.Cancel = $true
    Show-PishkanMessage 'نصب در جریان است' 'تا پایان نصب صبر کنید. بستن پنجره در میانه نصب می‌تواند نصب نیمه‌کاره باقی بگذارد.' 'warning'
  }
})

Apply-PishkanTheme $form
Show-Page 'config'
if (-not $SkipChecks) {
  $nodeAvailable = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeAvailable) {
    Set-Footer 'برای اطمینان از آماده بودن سیستم، «بررسی سیستم» را بزنید.' 'muted'
  } else {
    $nodeButton.Visible = $true
    $startButton.Enabled = $false
    Set-Footer 'Node.js پیدا نشد — دکمه «نصب Node.js» را بزنید.' 'warn'
  }
}
[void]$form.ShowDialog()
