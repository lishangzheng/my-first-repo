# Report the runtime status of the local two-model bridge.
# ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI).
$ErrorActionPreference = 'Continue'

$endpoints = @(
  @{ name = 'DeepSeek debug browser'; port = 9222 },
  @{ name = 'Qianwen client       '; port = 9223 }
)

foreach ($e in $endpoints) {
  $listen = Get-NetTCPConnection -State Listen -LocalPort $e.port -ErrorAction SilentlyContinue
  if (-not $listen) {
    "[DOWN] $($e.name) : nothing listening on 127.0.0.1:$($e.port)"
    continue
  }
  $owner = ($listen | Select-Object -First 1).OwningProcess
  $pname = try { (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { '?' }
  "[UP]   $($e.name) : 127.0.0.1:$($e.port) held by $pname (pid $owner)"
  try {
    $list = (Invoke-WebRequest "http://127.0.0.1:$($e.port)/json/list" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    $chat = $list | Where-Object { $_.type -eq 'page' -and $_.url -match 'chat|qianwen' } | Select-Object -First 3
    foreach ($t in $chat) { "         tab: $($t.title)  <$($t.url)>" }
  } catch {
    "         (could not read tab list: $($_.Exception.Message))"
  }
}

""
"backup of Qianwen login files:"
$bk = Join-Path $env:USERPROFILE '.dsh-bridge\qianwen-backup'
if (Test-Path $bk) { Get-ChildItem $bk | ForEach-Object { "  $($_.Name)  ($($_.Length) bytes)" } } else { "  (none)" }
