# Pishkan — graphical manager (WinForms).
#
# Launched by windows\PishkanManager.cmd and by the Start-menu shortcut.
# Shows the real state of every local service (backend, API, frontend, database,
# file storage), starts/stops/restarts the server, shows logs, opens the data
# folder and creates or restores database backups.
#
# All operations are executed through windows/lib/manager.mjs, so the same
# commands can be run from a terminal and are covered by the automated tests.

param(
  [string]$Root = '',
  [string]$Theme = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ui.ps1')

$settings = Load-UiSettings
if ($Theme) { Set-PishkanTheme $Theme } else { Set-PishkanTheme $settings.theme }
Register-PishkanErrorHandler (Get-RepositoryRoot $PSScriptRoot)

$RepoRoot = Get-RepositoryRoot (Get-Location).Path
if ($Root) { $RepoRoot = (Resolve-Path $Root).Path }
$Version = Get-PishkanVersion
$script:Busy = $false
$script:Status = $null
$script:AppUrl = ''
$script:Settings = $settings

# ------------------------------------------------------------------ window

$form = New-Object System.Windows.Forms.Form
$form.Text = "مدیریت Pishkan $Version"
$form.Width = 980
$form.Height = 700
$form.MinimumSize = New-Object System.Drawing.Size(980, 700)
$form.StartPosition = 'CenterScreen'
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = Get-PishkanFont 10 $false
$form.Tag = 'form'

$brand = New-PishkanPanel 960 92 'panel'
$brand.Location = New-Object System.Drawing.Point(0, 0)
$form.Controls.Add($brand)

$logo = New-PishkanPanel 52 52 'accent'
$logo.Location = New-Object System.Drawing.Point(886, 18)
$brand.Controls.Add($logo)
$logoLabel = New-PishkanLabel 'پ' 'accent' 22 $true
$logoLabel.Dock = 'Fill'
$logoLabel.TextAlign = 'MiddleCenter'
$logo.Controls.Add($logoLabel)

$brandTitle = New-PishkanLabel 'مدیریت Pishkan' 'title' 16 $true
$brandTitle.Location = New-Object System.Drawing.Point(540, 14)
$brandTitle.Size = New-Object System.Drawing.Size(330, 30)
$brandTitle.TextAlign = 'MiddleRight'
$brand.Controls.Add($brandTitle)

$brandSub = New-PishkanLabel "نسخه $Version · $RepoRoot" 'muted' 9 $false
$brandSub.Location = New-Object System.Drawing.Point(260, 46)
$brandSub.Size = New-Object System.Drawing.Size(610, 24)
$brandSub.TextAlign = 'MiddleRight'
$brand.Controls.Add($brandSub)

$themeButton = New-PishkanButton 'تغییر تم' 'ghost' 100 30
$themeButton.Location = New-Object System.Drawing.Point(24, 28)
$brand.Controls.Add($themeButton)

# ------------------------------------------------------------- status card

$statusPanel = New-PishkanPanel 620 250 'card'
$statusPanel.Location = New-Object System.Drawing.Point(320, 108)
$form.Controls.Add($statusPanel)

$statusTitle = New-PishkanLabel 'وضعیت سرویس‌ها' 'title' 12 $true
$statusTitle.Location = New-Object System.Drawing.Point(30, 14)
$statusTitle.Size = New-Object System.Drawing.Size(560, 28)
$statusTitle.TextAlign = 'MiddleRight'
$statusPanel.Controls.Add($statusTitle)

$script:ServiceRows = @{}
$rowTop = 52
foreach ($service in @(
  @{ id = 'backend'; title = 'Backend (Node.js)' },
  @{ id = 'api'; title = 'API' },
  @{ id = 'frontend'; title = 'رابط کاربری' },
  @{ id = 'database'; title = 'پایگاه داده' },
  @{ id = 'storage'; title = 'ذخیره‌سازی فایل' }
)) {
  $dot = New-PishkanLabel '●' 'muted' 11 $true
  $dot.Location = New-Object System.Drawing.Point(556, $rowTop)
  $dot.Size = New-Object System.Drawing.Size(24, 24)
  $dot.TextAlign = 'MiddleCenter'
  $statusPanel.Controls.Add($dot)

  $name = New-PishkanLabel $service.title 'text' 9.5 $true
  $name.Location = New-Object System.Drawing.Point(250, $rowTop)
  $name.Size = New-Object System.Drawing.Size(300, 24)
  $name.TextAlign = 'MiddleRight'
  $statusPanel.Controls.Add($name)

  $detail = New-PishkanLabel '—' 'muted' 9 $false
  $detail.Location = New-Object System.Drawing.Point(30, $rowTop)
  $detail.Size = New-Object System.Drawing.Size(215, 24)
  $detail.TextAlign = 'MiddleLeft'
  $statusPanel.Controls.Add($detail)

  $script:ServiceRows[$service.id] = @{ dot = $dot; detail = $detail }
  $rowTop += 34
}

$verdict = New-PishkanLabel 'در حال بررسی…' 'muted' 10 $true
$verdict.Location = New-Object System.Drawing.Point(30, 222)
$verdict.Size = New-Object System.Drawing.Size(560, 24)
$verdict.TextAlign = 'MiddleRight'
$statusPanel.Controls.Add($verdict)

# ---------------------------------------------------------------- actions

$actionsPanel = New-PishkanPanel 300 250 'card'
$actionsPanel.Location = New-Object System.Drawing.Point(12, 108)
$form.Controls.Add($actionsPanel)

$actionsTitle = New-PishkanLabel 'عملیات' 'title' 12 $true
$actionsTitle.Location = New-Object System.Drawing.Point(24, 14)
$actionsTitle.Size = New-Object System.Drawing.Size(250, 26)
$actionsTitle.TextAlign = 'MiddleRight'
$actionsPanel.Controls.Add($actionsTitle)

$startButton = New-PishkanButton 'شروع' 'accent' 120 38
$startButton.Location = New-Object System.Drawing.Point(154, 52)
$actionsPanel.Controls.Add($startButton)

$stopButton = New-PishkanButton 'توقف' 'ghost' 120 38
$stopButton.Location = New-Object System.Drawing.Point(24, 52)
$actionsPanel.Controls.Add($stopButton)

$restartButton = New-PishkanButton 'راه‌اندازی دوباره' 'ghost' 120 38
$restartButton.Location = New-Object System.Drawing.Point(154, 98)
$actionsPanel.Controls.Add($restartButton)

$openButton = New-PishkanButton 'باز کردن Pishkan' 'accent' 120 38
$openButton.Location = New-Object System.Drawing.Point(24, 98)
$actionsPanel.Controls.Add($openButton)

$dataButton = New-PishkanButton 'پوشه داده' 'ghost' 120 34
$dataButton.Location = New-Object System.Drawing.Point(154, 146)
$actionsPanel.Controls.Add($dataButton)

$backupButton = New-PishkanButton 'پشتیبان‌گیری' 'ghost' 120 34
$backupButton.Location = New-Object System.Drawing.Point(24, 146)
$actionsPanel.Controls.Add($backupButton)

$restoreButton = New-PishkanButton 'بازیابی' 'ghost' 120 34
$restoreButton.Location = New-Object System.Drawing.Point(154, 186)
$actionsPanel.Controls.Add($restoreButton)

$refreshButton = New-PishkanButton 'به‌روزرسانی وضعیت' 'ghost' 120 34
$refreshButton.Location = New-Object System.Drawing.Point(24, 186)
$actionsPanel.Controls.Add($refreshButton)

# ------------------------------------------------------------------- logs

$logPanel = New-PishkanPanel 620 268 'card'
$logPanel.Location = New-Object System.Drawing.Point(320, 366)
$form.Controls.Add($logPanel)

$logTitle = New-PishkanLabel 'گزارش زنده سرور' 'title' 12 $true
$logTitle.Location = New-Object System.Drawing.Point(20, 10)
$logTitle.Size = New-Object System.Drawing.Size(400, 26)
$logTitle.TextAlign = 'MiddleRight'
$logPanel.Controls.Add($logTitle)

$autoRefresh = New-Object System.Windows.Forms.CheckBox
$autoRefresh.Text = 'به‌روزرسانی خودکار'
$autoRefresh.Checked = $true
$autoRefresh.AutoSize = $true
$autoRefresh.Location = New-Object System.Drawing.Point(20, 12)
$autoRefresh.Tag = 'text'
$autoRefresh.ForeColor = Get-PishkanColor 'muted'
$logPanel.Controls.Add($autoRefresh)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.WordWrap = $false
$logBox.Location = New-Object System.Drawing.Point(20, 44)
$logBox.Size = New-Object System.Drawing.Size(580, 210)
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$logBox.Tag = 'log'
$logPanel.Controls.Add($logBox)

$infoPanel = New-PishkanPanel 300 268 'card'
$infoPanel.Location = New-Object System.Drawing.Point(12, 366)
$form.Controls.Add($infoPanel)

$infoTitle = New-PishkanLabel 'اطلاعات نصب' 'title' 12 $true
$infoTitle.Location = New-Object System.Drawing.Point(20, 10)
$infoTitle.Size = New-Object System.Drawing.Size(250, 26)
$infoTitle.TextAlign = 'MiddleRight'
$infoPanel.Controls.Add($infoTitle)

$infoText = New-PishkanLabel '' 'muted' 9 $false
$infoText.Location = New-Object System.Drawing.Point(20, 44)
$infoText.Size = New-Object System.Drawing.Size(250, 210)
$infoText.TextAlign = 'TopRight'
$infoPanel.Controls.Add($infoText)

$footer = New-PishkanPanel 960 32 'form'
$footer.Location = New-Object System.Drawing.Point(0, 640)
$form.Controls.Add($footer)

$footerText = New-PishkanLabel 'آماده' 'muted' 9 $false
$footerText.Location = New-Object System.Drawing.Point(20, 4)
$footerText.Size = New-Object System.Drawing.Size(920, 24)
$footerText.TextAlign = 'MiddleRight'
$footer.Controls.Add($footerText)

# ------------------------------------------------------------------ helpers

function Set-Footer([string]$Text, [string]$Role = 'muted') {
  $footerText.Text = $Text
  $footerText.ForeColor = Get-PishkanColor $Role
}

function Invoke-Manager([string[]]$Arguments) {
  $node = Get-NodeCommand
  if (-not $node) { throw 'Node.js پیدا نشد؛ نصب برنامه ناقص است.' }
  $managerScript = Join-Path $RepoRoot 'windows\lib\manager.mjs'
  $output = & $node $managerScript @Arguments --root $RepoRoot --json 2>&1
  $line = ($output | Where-Object { "$_" -like 'RESULT_JSON:*' } | Select-Object -Last 1)
  if (-not $line) { return @{ ok = $false; message = ($output -join "`n") } }
  return ("$line".Substring(12) | ConvertFrom-Json)
}

function Update-Status {
  if ($script:Busy) { return }
  $script:Busy = $true
  try {
    $status = Invoke-Manager @('status')
    $script:Status = $status
    foreach ($id in $script:ServiceRows.Keys) {
      $row = $script:ServiceRows[$id]
      $service = $status.services | Where-Object { $_.id -eq $id } | Select-Object -First 1
      if ($service) {
        $role = 'danger'
        if ($service.ok) { $role = 'ok' }
        $row.dot.ForeColor = Get-PishkanColor $role
        $row.detail.Text = [string]$service.detail
        $row.detail.ForeColor = Get-PishkanColor 'muted'
      }
    }
    if ($status.running) {
      $verdict.Text = "در حال اجرا · پورت $($status.port) · مدت اجرا $([int]($status.uptimeSeconds / 60)) دقیقه"
      $verdict.ForeColor = Get-PishkanColor 'ok'
      $script:AppUrl = [string]$status.url
      $startButton.Enabled = $false
      $stopButton.Enabled = $true
      $restartButton.Enabled = $true
      $openButton.Enabled = $true
    } else {
      $verdict.Text = 'متوقف است'
      $verdict.ForeColor = Get-PishkanColor 'warn'
      $startButton.Enabled = $true
      $stopButton.Enabled = $false
      $restartButton.Enabled = $false
      $openButton.Enabled = $false
    }
    $infoText.Text = ("پورت: {0}`nپایگاه داده: {1}`nپوشه داده: {2}`nفایل تنظیمات: {3}`nگزارش: {4}" -f `
      $status.port, (Split-Path $status.envFile -Leaf), $status.dataDir, $status.envFile, $status.logFile)
    if ($autoRefresh.Checked -and $status.running) {
      $log = Invoke-Manager @('logs', '--lines', '40')
      if ($log -and $log.lines) { $logBox.Text = ($log.lines -join "`r`n") }
    }
  } catch {
    Set-Footer ("خطا در خواندن وضعیت: " + $_.Exception.Message) 'danger'
  } finally {
    $script:Busy = $false
  }
}

function Invoke-Action([string]$Label, [string[]]$Arguments, [string]$SuccessText) {
  if ($script:Busy) { return }
  $script:Busy = $true
  Set-Footer ($Label + ' — کمی صبر کنید…') 'warn'
  [System.Windows.Forms.Application]::DoEvents()
  try {
    $result = Invoke-Manager $Arguments
    if ($result.ok) {
      Set-Footer $SuccessText 'ok'
    } else {
      Set-Footer ("$Label ناموفق بود: " + $result.message) 'danger'
      Show-PishkanMessage ($Label + ' ناموفق بود') ([string]$result.message) 'error'
    }
  } catch {
    Set-Footer ($Label + ' با خطا مواجه شد') 'danger'
    Show-PishkanMessage ($Label + ' با خطا مواجه شد') $_.Exception.Message 'error'
  } finally {
    $script:Busy = $false
    Update-Status
  }
}

# ------------------------------------------------------------------ wiring

$themeButton.Add_Click({
  if ($script:Settings.theme -eq 'dark') { Set-PishkanTheme 'light' } else { Set-PishkanTheme 'dark' }
  $script:Settings.theme = $script:ThemeMode
  Save-UiSettings $script:Settings
  Apply-PishkanTheme $form
  $autoRefresh.ForeColor = Get-PishkanColor 'muted'
})

$startButton.Add_Click({ Invoke-Action 'شروع سرویس' @('start') 'سرویس راه‌اندازی شد.' })
$stopButton.Add_Click({ Invoke-Action 'توقف سرویس' @('stop') 'سرویس متوقف شد.' })
$restartButton.Add_Click({ Invoke-Action 'راه‌اندازی دوباره' @('restart') 'سرویس دوباره راه‌اندازی شد.' })
$refreshButton.Add_Click({ Update-Status })
$openButton.Add_Click({ if ($script:AppUrl) { Start-Process $script:AppUrl } })
$dataButton.Add_Click({ [void](Invoke-Manager @('open-data')) })

$backupButton.Add_Click({
  if ($script:Busy) { return }
  $script:Busy = $true
  Set-Footer 'در حال ساخت پشتیبان…' 'warn'
  [System.Windows.Forms.Application]::DoEvents()
  try {
    $result = Invoke-Manager @('backup')
    if ($result.ok) {
      Set-Footer ("پشتیبان ساخته شد: " + $result.file) 'ok'
      Show-PishkanMessage 'پشتیبان‌گیری' ("پشتیبان ساخته شد:`n" + $result.file) 'info'
    } else {
      Show-PishkanMessage 'پشتیبان‌گیری ناموفق بود' ([string]$result.message) 'error'
    }
  } catch {
    Show-PishkanMessage 'پشتیبان‌گیری ناموفق بود' $_.Exception.Message 'error'
  } finally {
    $script:Busy = $false
  }
})

$restoreButton.Add_Click({
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'انتخاب فایل پشتیبان Pishkan'
  $dialog.Filter = 'Pishkan backup (*.sqlite)|*.sqlite|همه فایل‌ها (*.*)|*.*'
  $backupFolder = Join-Path $RepoRoot '.data\backups'
  if (Test-Path $backupFolder) { $dialog.InitialDirectory = $backupFolder }
  if ($dialog.ShowDialog() -ne 'OK') { return }
  $confirm = [System.Windows.Forms.MessageBox]::Show(
    "پایگاه داده فعلی با نسخه پشتیبان جایگزین می‌شود.`nیک نسخه از وضعیت فعلی به‌صورت خودکار نگه داشته می‌شود.`n`nادامه می‌دهید؟",
    'بازیابی پایگاه داده', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
  if ($confirm -ne 'Yes') { return }
  Invoke-Action 'بازیابی' @('restore', '--file', $dialog.FileName) 'پایگاه داده بازیابی شد.'
})

$autoRefresh.Add_CheckedChanged({
  if ($autoRefresh.Checked) { Update-Status }
})

$clock = New-Object System.Windows.Forms.Timer
$clock.Interval = 5000
$clock.Add_Tick({ if ($autoRefresh.Checked) { Update-Status } })

$form.Add_Shown({
  Apply-PishkanTheme $form
  $autoRefresh.ForeColor = Get-PishkanColor 'muted'
  Update-Status
  $clock.Start()
})

$form.Add_FormClosed({ $clock.Stop() })

Apply-PishkanTheme $form
[void]$form.ShowDialog()
