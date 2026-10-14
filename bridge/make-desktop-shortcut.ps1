# Create the desktop shortcut for the two-model bridge launcher.
#
# The .bat itself keeps an ASCII name (cmd mangles CJK paths), so the Chinese,
# self-explanatory name lives here on the shortcut, which is what the user
# actually sees and double-clicks.
#
# ASCII-only source (Windows PowerShell 5.1 reads .ps1 as ANSI).

$ErrorActionPreference = 'Stop'

$bridge = $PSScriptRoot
$target = Join-Path $bridge 'launch-bridge.bat'
if (-not (Test-Path $target)) { throw "launcher not found: $target" }

# Shortcut name and tooltip come from the same strings file as the UI, so there
# is exactly one place to change the wording.
$S = [System.IO.File]::ReadAllText((Join-Path $bridge 'launcher-strings.json'), [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json

$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop ($S.shortcutName + '.lnk')

# Icon: prefer the bridge browser's own icon, fall back to a generic console.
$icon = $null
foreach ($candidate in @(
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)) {
  if (Test-Path $candidate) { $icon = $candidate; break }
}
if (-not $icon) { $icon = Join-Path $env:SystemRoot 'System32\cmd.exe' }

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($linkPath)
$sc.TargetPath = $target
$sc.WorkingDirectory = $bridge
$sc.Description = $S.shortcutTooltip
$sc.IconLocation = "$icon,0"
$sc.WindowStyle = 7   # start minimized: the launcher is a progress report, not a workspace
$sc.Save()

# Verify what we actually wrote, rather than trusting the call succeeded.
$check = $shell.CreateShortcut($linkPath)
"created : $linkPath"
"target  : $($check.TargetPath)"
"workdir : $($check.WorkingDirectory)"
"icon    : $($check.IconLocation)"
"tooltip : $($check.Description)"
"exists  : $(Test-Path $linkPath)"
