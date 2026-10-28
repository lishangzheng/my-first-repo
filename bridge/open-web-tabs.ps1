# Ensure every web model has a tab in the shared debug browser (9222).
#
#   DeepSeek / Kimi / MiniMax Code / 智谱清言 all live in the ONE bridge Chrome.
#   This script only opens what is missing; it never starts or closes the browser.
#   First-time login for a site happens by hand in that window (the profile keeps
#   it afterwards).
#
# ASCII-only (Windows PowerShell 5.1 reads a .ps1 as ANSI).
$ErrorActionPreference = 'Continue'

$port = 9222
$targets = @(
  @{ name = 'deepseek'; url = 'https://chat.deepseek.com/';          pattern = 'chat\.deepseek\.com' },
  @{ name = 'kimi';     url = 'https://www.kimi.com/';                pattern = 'kimi\.com' },
  @{ name = 'minimax';  url = 'https://agent.minimax.cn/';            pattern = 'agent\.minimax\.' },
  @{ name = 'chatglm';  url = 'https://chatglm.cn/main/alltoolsdetail'; pattern = 'chatglm\.cn' }
)

# TCP-connect probe, not just Get-NetTCPConnection: the latter returns nothing
# (not even an error) in some sandboxed contexts and would report a healthy
# browser as missing.
function Test-Listening([int]$p) {
  try { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction Stop) { return $true } } catch { }
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500)
    if ($ok -and $c.Connected) { $c.Close(); return $true }
    $c.Close(); return $false
  } catch { return $false }
}

if (-not (Test-Listening $port)) {
  "bridge browser is not running (nothing listening on 127.0.0.1:$port)"
  "start it first: start-browser.ps1"
  exit 1
}

function Get-Tabs {
  try {
    return (Invoke-WebRequest "http://127.0.0.1:$port/json/list" -UseBasicParsing -TimeoutSec 8).Content | ConvertFrom-Json
  } catch { return $null }
}

$tabs = Get-Tabs
if (-not $tabs) { "could not read the tab list on $port"; exit 1 }

$missing = 0
foreach ($t in $targets) {
  $found = $tabs | Where-Object { $_.type -eq 'page' -and $_.url -match $t.pattern } | Select-Object -First 1
  if ($found) { "  [have] " + $t.name; continue }

  try {
    $null = Invoke-WebRequest -Uri ("http://127.0.0.1:$port/json/new?" + $t.url) -Method Put -UseBasicParsing -TimeoutSec 20
    "  [open] " + $t.name
  } catch {
    "  [fail] " + $t.name + " : " + $_.Exception.Message
    $missing++
  }
}

Start-Sleep -Seconds 2
$tabs = Get-Tabs
foreach ($t in $targets) {
  $found = $tabs | Where-Object { $_.type -eq 'page' -and $_.url -match $t.pattern } | Select-Object -First 1
  if (-not $found) { "  [MISSING] " + $t.name; $missing++ }
}

if ($missing -gt 0) { exit 1 }
exit 0
