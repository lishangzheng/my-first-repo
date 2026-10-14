# Force the main Qianwen window to the foreground.
#
# Why this matters: the Qianwen client's chat tab reports
# document.visibilityState === "hidden" while its window is not actually shown,
# and a hidden Chromium page does not render the streaming answer. The bridge
# then reads an empty answer card and reports no progress. Restoring the window
# is a prerequisite for reading answers, not a nicety.
#
# ASCII-only source (Windows PowerShell 5.1 reads .ps1 as ANSI).
$ErrorActionPreference = 'Continue'

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class QwenFront {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue

$HWND_TOP = [IntPtr]::Zero
$SWP_NOMOVE = 0x0002
$SWP_NOSIZE = 0x0001
$SWP_SHOWWINDOW = 0x0040

$targets = New-Object System.Collections.ArrayList
$cb = [QwenFront+EnumProc]{
  param($h, $l)
  $p = 0
  [QwenFront]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  $proc = ''
  try { $proc = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { return $true }
  if ($proc -ne 'qianwen') { return $true }
  $cls = New-Object System.Text.StringBuilder 256
  [QwenFront]::GetClassName($h, $cls, 256) | Out-Null
  if ($cls.ToString() -ne 'Chrome_WidgetWin_1') { return $true }
  $t = New-Object System.Text.StringBuilder 512
  [QwenFront]::GetWindowText($h, $t, 512) | Out-Null
  if ($t.Length -eq 0) { return $true }
  [void]$targets.Add([pscustomobject]@{ h = $h; title = $t.ToString() })
  return $true
}
[QwenFront]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

if ($targets.Count -eq 0) {
  "no Qianwen top-level window found -- the client may be closed entirely"
  exit 1
}

foreach ($w in $targets) {
  $before = "vis=$([QwenFront]::IsWindowVisible($w.h)) min=$([QwenFront]::IsIconic($w.h))"
  [void][QwenFront]::ShowWindow($w.h, 9)                       # SW_RESTORE
  Start-Sleep -Milliseconds 300
  [void][QwenFront]::ShowWindow($w.h, 5)                       # SW_SHOW
  [void][QwenFront]::SetWindowPos($w.h, $HWND_TOP, 0, 0, 0, 0, ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW))
  [void][QwenFront]::BringWindowToTop($w.h)
  [void][QwenFront]::SetForegroundWindow($w.h)
  Start-Sleep -Milliseconds 500
  $r = New-Object QwenFront+RECT
  [void][QwenFront]::GetWindowRect($w.h, [ref]$r)
  "title='$($w.title)'  before: $before  after: vis=$([QwenFront]::IsWindowVisible($w.h)) min=$([QwenFront]::IsIconic($w.h)) rect=$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
}
