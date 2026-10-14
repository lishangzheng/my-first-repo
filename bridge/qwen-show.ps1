# Restore the Qianwen main window (Electron/Chromium) so its UI can be read.
# ASCII-only source: Windows PowerShell 5.1 reads .ps1 as ANSI, so non-ASCII
# literals inside this file are unreliable. Process/class matching only.
# Non-destructive: ShowWindow(SW_RESTORE) only. Never closes, never kills.
$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinShow2 {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
Add-Type -TypeDefinition $sig

$targets = New-Object System.Collections.ArrayList
$cb = [WinShow2+EnumProc]{
  param($h, $l)
  $p = 0
  [WinShow2]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  $proc = ''
  try { $proc = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { return $true }
  if ($proc -ne 'qianwen') { return $true }
  $cls = New-Object System.Text.StringBuilder 256
  [WinShow2]::GetClassName($h, $cls, 256) | Out-Null
  $t = New-Object System.Text.StringBuilder 512
  [WinShow2]::GetWindowText($h, $t, 512) | Out-Null
  if ($cls.ToString() -eq 'Chrome_WidgetWin_1' -and $t.Length -gt 0) {
    [void]$targets.Add([pscustomobject]@{ h = $h; pid = $p; title = $t.ToString(); vis = [WinShow2]::IsWindowVisible($h) })
  }
  return $true
}
[WinShow2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

"candidates: $($targets.Count)"
foreach ($w in $targets) {
  "before: pid=$($w.pid) vis=$($w.vis) title=$($w.title)"
  [void][WinShow2]::ShowWindow($w.h, 9)   # SW_RESTORE
  Start-Sleep -Milliseconds 500
  [void][WinShow2]::ShowWindow($w.h, 5)   # SW_SHOW
  [void][WinShow2]::SetForegroundWindow($w.h)
  Start-Sleep -Milliseconds 500
  "after : vis=$([WinShow2]::IsWindowVisible($w.h))"
}
