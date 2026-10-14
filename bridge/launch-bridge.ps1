# One-click launcher for the local two-model bridge.
#
# Brings up BOTH sides used by cross-check and reports whether they are ready:
#   * DeepSeek web   - dedicated debug Chrome on 127.0.0.1:9222
#   * Qianwen client - the local app, restarted with a debug port on 127.0.0.1:9223
#
# ASCII-ONLY SOURCE, deliberately. Windows PowerShell 5.1 reads a .ps1 as ANSI
# unless it carries a UTF-8 BOM, and losing that BOM silently turns Chinese
# literals into mojibake that breaks parsing. All user-facing Chinese therefore
# lives in launcher-strings.json, which is read with an explicit UTF-8 decoder.
#
# Nothing here monitors anything: it starts two programs, checks two ports and
# exits. Safe to run twice; both steps are idempotent.

param([switch]$Quiet, [switch]$Trace)

$ErrorActionPreference = 'Continue'
$bridge = $PSScriptRoot
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Stage tracing, opt-in via -Trace. Writes to launcher-trace.log so a hang can
# be localised to a line instead of guessed at.
$tracePath = Join-Path $bridge 'launcher-trace.log'
function Trace([string]$stage) {
  if (-not $Trace) { return }
  try {
    $line = (Get-Date).ToString('HH:mm:ss.fff') + "  " + $stage
    [System.IO.File]::AppendAllText($tracePath, $line + "`r`n", [System.Text.UTF8Encoding]::new($false))
  } catch { }
}
if ($Trace) {
  try { [System.IO.File]::WriteAllText($tracePath, "launcher trace " + (Get-Date).ToString('s') + "`r`n", [System.Text.UTF8Encoding]::new($false)) } catch { }
}
Trace 'start'

# ---------------------------------------------------------------- strings
$S = $null
$stringsPath = Join-Path $bridge 'launcher-strings.json'
try {
  $S = [System.IO.File]::ReadAllText($stringsPath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
} catch {
  Write-Host "launcher-strings.json is missing or invalid: $stringsPath"
  Write-Host "run: $bridge\status.ps1"
  exit 2
}

function Say([string]$key) {
  if ($S -and $S.PSObject.Properties[$key]) { return [string]$S.$key }
  return $key
}

function Write-Head([string]$key) { Write-Host ""; Write-Host ("== " + (Say $key) + " ==") -ForegroundColor Cyan }
function Write-Ok([string]$key)   { Write-Host ("   " + (Say 'tagOk') + "   " + (Say $key)) -ForegroundColor Green }
function Write-Note([string]$key) { Write-Host ("   " + (Say 'tagNote') + " " + (Say $key)) -ForegroundColor Yellow }
function Write-Bad([string]$key)  { Write-Host ("   " + (Say 'tagBad') + " " + (Say $key)) -ForegroundColor Red }

function Test-Port([int]$port) {
  try { return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop) }
  catch { return $false }
}

# Run one helper script to completion, WITHOUT letting it capture the console.
#
# Why not Start-Process -Wait or a plain "&": the helper launches Chrome, and a
# child inherits the caller's stdout/stderr handles. Start-Process -Wait then
# waits for that inherited handle to close too, which happens only when the
# browser exits -- so a double-clicked launcher would sit there forever.
# Redirecting all three streams to the null device gives the helper its own
# handles, so it can exit cleanly; the helper polls its own port internally and
# this function additionally waits for that port before returning.
# Start one helper script and then wait for its PORT, never for the script.
#
# The trap this avoids: the helper launches Chrome. Chrome inherits whatever
# stdout/stderr handles the helper holds and keeps them open for as long as the
# browser lives, so ANY form of waiting on the helper (Start-Process -Wait, a
# pipeline, ReadToEnd on a redirected pipe) blocks until the browser exits --
# a double-clicked launcher would appear frozen.
#
# The helper is therefore started by the WMI host instead of by this process:
# Win32_Process.Create detaches the new process completely, so it inherits no
# handle of ours and Chrome inherits none either. Success is decided by the
# port alone -- the helper's exit code is never consulted.
function Run-Step([string]$scriptName, [int]$port, [int]$timeoutSec = 90) {
  $full = Join-Path $bridge $scriptName
  if (-not (Test-Path $full)) {
    Write-Host ("   " + (Say 'missingFile') + " " + $full) -ForegroundColor Red
    return
  }

  $cmd = '"' + $ps + '" -NoProfile -ExecutionPolicy Bypass -File "' + $full + '"'
  try {
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
      -Arguments @{ CommandLine = $cmd } -ErrorAction Stop
    if ($r.ReturnValue -ne 0) {
      Write-Host ("   step could not start (WMI code " + $r.ReturnValue + ")") -ForegroundColor Red
      return
    }
  } catch {
    # Fallback path if WMI is unavailable: start it directly and do not wait,
    # accepting that the helper may outlive us -- the port still decides.
    Write-Host ("   (WMI unavailable, starting directly: " + $_.Exception.Message + ")") -ForegroundColor DarkGray
    try {
      Start-Process -FilePath $ps `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $full) | Out-Null
    } catch {
      Write-Host ("   step failed to start: " + $_.Exception.Message) -ForegroundColor Red
      return
    }
  }

  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $port) { return }
    Start-Sleep -Milliseconds 700
  }
  # Timed out: stop waiting but leave the browser alone. Closing it here would
  # destroy a possibly-working session just because it was slow to start.
  Write-Host ("   (" + $scriptName + " did not open its port in " + $timeoutSec + "s)") -ForegroundColor DarkGray
}

Write-Host "=====================================================" -ForegroundColor White
Write-Host ("  " + (Say 'windowTitle')) -ForegroundColor White
Write-Host ("  " + (Say 'windowSubtitle')) -ForegroundColor Gray
Write-Host "=====================================================" -ForegroundColor White

# --------------------------------------------------------------- DeepSeek
Write-Head 'step1'
if (Test-Port 9222) {
  Trace 'deepseek already up'
  Write-Ok 'dsRunning'
} else {
  Write-Host ("   " + (Say 'dsStarting'))
  Trace 'deepseek: launching helper'
  Run-Step 'start-browser.ps1' 9222
  Trace ('deepseek: helper wait done, port=' + (Test-Port 9222))
  if (Test-Port 9222) { Write-Ok 'dsReady' }
  else {
    Write-Bad 'dsFailed'
    Write-Host ("   " + (Say 'manualTry') + "$bridge\start-browser.ps1") -ForegroundColor Yellow
  }
}

# ----------------------------------------------------------------- Qianwen
Write-Head 'step2'
if (Test-Port 9223) {
  Trace 'qianwen already up'
  Write-Ok 'qwRunning'
} else {
  $running = @(Get-Process qianwen -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    Write-Note 'qwRestartNote'
    Write-Host ("   " + (Say 'qwLoginNote')) -ForegroundColor Gray
    Write-Host ("   " + (Say 'qwCancelNote')) -ForegroundColor Gray
    Start-Sleep -Seconds 5
    Write-Host ("   " + (Say 'qwRestarting'))
  } else {
    Write-Host ("   " + (Say 'qwStarting'))
  }
  Trace 'qianwen: launching helper'
  Run-Step 'start-qwen-debug.ps1' 9223
  Trace ('qianwen: helper wait done, port=' + (Test-Port 9223))
  if (Test-Port 9223) { Write-Ok 'qwReady' }
  else {
    Write-Bad 'qwFailed'
    Write-Host ("   " + (Say 'manualTry') + "$bridge\start-qwen-debug.ps1") -ForegroundColor Yellow
  }
}

# ------------------------------------------------------------- final state
Trace 'final status'
Write-Head 'finalStatus'
$ds = Test-Port 9222
$qw = Test-Port 9223

if ($ds) { Write-Ok 'dsAvailable' } else { Write-Bad 'dsUnavailable' }
if ($qw) { Write-Ok 'qwAvailable' } else { Write-Bad 'qwUnavailable' }

Write-Host ""
if ($ds -and $qw) {
  Write-Host ("   " + (Say 'allReady')) -ForegroundColor Green
  Write-Host ("   " + (Say 'howToUse')) -ForegroundColor White
  Write-Host ("      " + (Say 'exampleAsk')) -ForegroundColor Yellow
  Write-Host ""
  Write-Host ("   " + (Say 'keepOpen')) -ForegroundColor Gray
} else {
  Write-Host ("   " + (Say 'partial')) -ForegroundColor Yellow
  Write-Host ("   " + (Say 'troubleshoot') + "$bridge\status.ps1") -ForegroundColor Gray
  Write-Host ("   " + (Say 'commonCause')) -ForegroundColor Gray
}

Write-Host ""
if ($Quiet -or [System.Console]::IsInputRedirected) {
  # Non-interactive run (piped, redirected or scripted): never block on a key.
  Write-Host ("   " + (Say 'nonInteractive')) -ForegroundColor DarkGray
} else {
  Trace 'waiting for keypress'
  Write-Host ("   " + (Say 'pressAnyKey')) -ForegroundColor DarkGray
  try { [void][System.Console]::ReadKey($true) } catch { }
}
Trace 'end of script reached'
