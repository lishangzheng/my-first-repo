# Report the runtime status of the local multi-model bridge.
# ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI).
#
# Ports and models are no longer 1:1: DeepSeek and Kimi share one debug Chrome
# (9222) as two tabs, so this reports both the listening endpoints and, per
# model, whether its conversation tab is actually there.
$ErrorActionPreference = 'Continue'

# A listening check that cannot lie: Get-NetTCPConnection returns nothing when the
# sandbox denies it, which would report a healthy channel as DOWN.
function Test-Listening([int]$port) {
  try { if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop) { return $true } } catch { }
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500)
    if ($ok -and $c.Connected) { $c.Close(); return $true }
    $c.Close(); return $false
  } catch { return $false }
}

$endpoints = @(
  @{ name = 'DeepSeek+Kimi debug browser'; port = 9222 },
  @{ name = 'Qianwen client             '; port = 9223 }
)

foreach ($e in $endpoints) {
  $listen = Test-Listening $e.port
  if (-not $listen) {
    "[DOWN] $($e.name) : nothing listening on 127.0.0.1:$($e.port)"
    continue
  }
  $conn = Get-NetTCPConnection -State Listen -LocalPort $e.port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    $owner = $conn.OwningProcess
    $pname = try { (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { '?' }
    "[UP]   $($e.name) : 127.0.0.1:$($e.port) held by $pname (pid $owner)"
  } else {
    "[UP]   $($e.name) : 127.0.0.1:$($e.port) accepts connections (owner unknown: port query denied)"
  }
  try {
    $list = (Invoke-WebRequest "http://127.0.0.1:$($e.port)/json/list" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    $pages = @($list | Where-Object { $_.type -eq 'page' })
    foreach ($t in $pages) { "         tab: $($t.title)  <$($t.url)>" }
  } catch {
    "         (could not read tab list: $($_.Exception.Message))"
  }
}

""
"per-model tab check:"
$sites = @(
  @{ name = 'deepseek'; port = 9222; pattern = 'chat\.deepseek\.com' },
  @{ name = 'kimi    '; port = 9222; pattern = 'kimi\.com' },
  @{ name = 'minimax '; port = 9222; pattern = 'agent\.minimax\.' },
  @{ name = 'chatglm '; port = 9222; pattern = 'chatglm\.cn' },
  @{ name = 'qwen    '; port = 9223; pattern = 'qianwen\.com' }
)
foreach ($s in $sites) {
  if (-not (Test-Listening $s.port)) {
    "[MISS] $($s.name) : port $($s.port) is not listening"
    continue
  }
  try {
    $list = (Invoke-WebRequest "http://127.0.0.1:$($s.port)/json/list" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    $tab = $list | Where-Object { $_.type -eq 'page' -and $_.url -match $s.pattern } | Select-Object -First 1
    if ($tab) { "[OK]   $($s.name) : $($tab.title)" } else { "[MISS] $($s.name) : no matching tab on port $($s.port)" }
  } catch {
    "[MISS] $($s.name) : could not read tab list ($($_.Exception.Message))"
  }
}

""
"backup of Qianwen login files:"
$bk = Join-Path $env:USERPROFILE '.dsh-bridge\qianwen-backup'
if (Test-Path $bk) { Get-ChildItem $bk | ForEach-Object { "  $($_.Name)  ($($_.Length) bytes)" } } else { "  (none)" }
