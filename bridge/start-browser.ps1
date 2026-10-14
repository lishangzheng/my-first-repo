# Start the dedicated bridge Chrome used for the DeepSeek web session.
# Same profile every time, so the login persists. Does not touch the user's
# everyday Chrome profile.
$ErrorActionPreference = 'Continue'

$chrome = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
if (-not (Test-Path $chrome)) { $chrome = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' }
if (-not (Test-Path $chrome)) { "Chrome not found"; exit 1 }

$prof = Join-Path $env:USERPROFILE '.dsh-bridge\chrome-profile'
New-Item -ItemType Directory -Force -Path $prof | Out-Null

$live = Get-NetTCPConnection -State Listen -LocalPort 9222 -ErrorAction SilentlyContinue
if ($live) { "already listening on 9222 (pid $(($live | Select-Object -First 1).OwningProcess))"; exit 0 }

Start-Process -FilePath $chrome -ArgumentList @(
  '--remote-debugging-port=9222',
  "--user-data-dir=$prof",
  '--no-first-run',
  '--no-default-browser-check',
  '--new-window',
  'https://chat.deepseek.com/'
)

$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 600
  try {
    $v = (Invoke-WebRequest 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
    "ready: $($v.Browser)"
    exit 0
  } catch { }
}
"timed out waiting for 9222"
exit 1
