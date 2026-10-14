# Qianwen client probe via Windows UI Automation (.NET built-in, no third-party code).
# Usage: pwsh -File qwen-uia-probe.ps1 [-MaxDepth 6]
param([int]$MaxDepth = 6)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Chrome_WidgetWin_1')

$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
"windows with Chrome_WidgetWin_1: " + $wins.Count

$target = $null
foreach ($w in $wins) {
  $p = $w.Current.ProcessId
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'qianwen') {
    "  pid=$p title='$($w.Current.Name)' class=$($w.Current.ClassName) offscreen=$($w.Current.IsOffscreen)"
    if (-not $target -or $w.Current.Name) { $target = $w }
  }
}

if (-not $target) { "NO QIANWEN WINDOW FOUND"; exit 1 }

"`n=== UIA tree (depth <= $MaxDepth) ==="
function Walk($el, $depth) {
  if ($depth -gt $MaxDepth) { return }
  $pad = '  ' * $depth
  $name = $el.Current.Name
  if ($null -eq $name) { $name = '' }
  $name = ($name -replace '\s+', ' ').Trim()
  if ($name.Length -gt 70) { $name = $name.Substring(0, 70) + '...' }
  $line = "$pad[$($el.Current.ControlType.ProgrammaticName -replace 'ControlType\.','')] '$name'"
  if ($el.Current.IsOffscreen) { $line += ' (offscreen)' }
  $line
  $kids = $el.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($k in $kids) { Walk $k ($depth + 1) }
}
Walk $target 0
