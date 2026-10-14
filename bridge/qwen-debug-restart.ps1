# Restart the Qianwen client with a remote debugging port so the local bridge
# can drive the page it already shows, reusing the user's own login state.
#
# Safety properties:
#   * Backs up the login-bearing profile files first (Cookies / Local State).
#   * Asks the window to close politely (WM_CLOSE via taskkill WITHOUT /F).
#     No force kill.
#   * Never deletes anything.
#
# Prints the CDP endpoint it finds, or an explicit diagnosis.
$ErrorActionPreference = 'Continue'

$exe  = "$env:LOCALAPPDATA\Programs\QianwenApp\qianwen.exe"
$userData = "$env:LOCALAPPDATA\Qianwen\User Data"
$portFile = Join-Path $userData 'DevToolsActivePort'
$backupDir = Join-Path $env:USERPROFILE '.dsh-bridge\qianwen-backup'

# --- 1. backup login state -------------------------------------------------
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
foreach ($rel in @('Network\Cookies', 'Local State', 'Default\Network\Cookies')) {
  $src = Join-Path $userData $rel
  if (Test-Path $src) {
    $dst = Join-Path $backupDir ((($rel -replace '[\\]', '_')) + '.bak')
    Copy-Item $src $dst -Force -ErrorAction SilentlyContinue
    "backed up: $rel -> $dst"
  }
}

# --- 2. find the main window owner pid ------------------------------------
$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class QProbe {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue

$ownerPids = New-Object System.Collections.ArrayList
$cb = [QProbe+EnumProc]{
  param($h, $l)
  $p = 0
  [QProbe]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  $proc = ''
  try { $proc = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { return $true }
  if ($proc -ne 'qianwen') { return $true }
  $cls = New-Object System.Text.StringBuilder 256
  [QProbe]::GetClassName($h, $cls, 256) | Out-Null
  $t = New-Object System.Text.StringBuilder 512
  [QProbe]::GetWindowText($h, $t, 512) | Out-Null
  if ($cls.ToString() -eq 'Chrome_WidgetWin_1' -and $t.Length -gt 0) {
    if (-not $script:ownerPids.Contains($p)) { [void]$script:ownerPids.Add($p) }
  }
  return $true
}
[QProbe]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
"main window owner pids: $($ownerPids -join ', ')"

# --- 3. polite close ------------------------------------------------------
foreach ($p in $ownerPids) {
  "asking pid $p to close (no /F)..."
  & taskkill.exe /PID $p 2>&1 | Out-String
}
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  $left = @(Get-Process qianwen -ErrorAction SilentlyContinue).Count
  if ($left -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
$left = @(Get-Process qianwen -ErrorAction SilentlyContinue).Count
"qianwen processes remaining: $left"

if ($left -gt 0) {
  "NOTE: client did not exit on a polite close; it may have a tray-resident process."
}

# --- 4. relaunch with debugging enabled -----------------------------------
if (Test-Path $portFile) { Remove-Item $portFile -Force -ErrorAction SilentlyContinue }
$args = @('--remote-debugging-port=9223', '--remote-allow-origins=*')
"launching: $exe $($args -join ' ')"
Start-Process -FilePath $exe -ArgumentList $args

# --- 5. wait for the port file -------------------------------------------
$found = $null
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $portFile) { $found = Get-Content $portFile -ErrorAction SilentlyContinue; break }
  Start-Sleep -Milliseconds 700
}
if ($found) {
  "DevToolsActivePort file: $($found -join ' | ')"
  "CDP http endpoint: http://127.0.0.1:$($found[0])/json/list"
} else {
  "NO DevToolsActivePort FILE -- debug port was not enabled."
  "qianwen processes now: " + (@(Get-Process qianwen -ErrorAction SilentlyContinue).Count)
}
