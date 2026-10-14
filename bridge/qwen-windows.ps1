# Enumerate every top-level window and map it to its owning process.
# Used to find how the Qianwen client exposes its UI (class name may differ
# from Chrome_WidgetWin_1, and a tray-only app may have no window at all).
$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@
Add-Type -TypeDefinition $sig

$rows = New-Object System.Collections.ArrayList
$cb = [WinEnum+EnumProc]{
  param($h, $l)
  $pid2 = 0
  [WinEnum]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  $sb = New-Object System.Text.StringBuilder 512
  [WinEnum]::GetWindowText($h, $sb, 512) | Out-Null
  $title = $sb.ToString()
  $cb2 = New-Object System.Text.StringBuilder 256
  [WinEnum]::GetClassName($h, $cb2, 256) | Out-Null
  $cls = $cb2.ToString()
  $pname = ''
  try { $pname = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch { $pname = '?' }
  [void]$rows.Add([pscustomobject]@{
    pid = $pid2; proc = $pname; cls = $cls
    vis = [WinEnum]::IsWindowVisible($h); min = [WinEnum]::IsIconic($h)
    title = $title; handle = $h
  })
  return $true
}
[WinEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

"=== windows owned by qianwen ==="
$rows | Where-Object { $_.proc -eq 'qianwen' } | Format-Table pid, cls, vis, min, title -AutoSize | Out-String -Width 200

"=== total top-level windows: $($rows.Count) ==="
"=== distinct processes with visible windows ==="
$rows | Where-Object { $_.vis -and $_.title } | Group-Object proc | Sort-Object Count -Descending |
  Select-Object Count, Name | Format-Table -AutoSize | Out-String -Width 120
