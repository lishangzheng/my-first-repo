# Start the Qianwen client WITH its remote debugging port.
# The debug port only exists when the process is launched with the flag, so a
# client started from the desktop icon cannot be driven. Login state lives in
# the app's own User Data dir and is reused.
$ErrorActionPreference = 'Continue'

# FILL IN: set this to your Qianwen install path if it is not under %LOCALAPPDATA%.
$exe = "$env:LOCALAPPDATA\Programs\QianwenApp\qianwen.exe"
if (-not (Test-Path $exe)) { "Qianwen client not found at $exe"; exit 1 }

$live = Get-NetTCPConnection -State Listen -LocalPort 9223 -ErrorAction SilentlyContinue
if ($live) { "already listening on 9223 (pid $(($live | Select-Object -First 1).OwningProcess))"; exit 0 }

$running = @(Get-Process qianwen -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  "Qianwen is running without the debug port; a second launch would be swallowed by its single-instance lock."
  "Asking it to close politely..."
  foreach ($p in $running) { & taskkill.exe /PID $p.Id /T 2>&1 | Out-Null }
  Start-Sleep -Seconds 5
  $still = @(Get-Process qianwen -ErrorAction SilentlyContinue)
  if ($still.Count -gt 0) {
    "Still alive after a polite close (tray-resident); forcing."
    foreach ($p in $still) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
    Start-Sleep -Seconds 4
  }
}

Start-Process -FilePath $exe -ArgumentList @('--remote-debugging-port=9223', '--remote-allow-origins=*')

$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  $l = Get-NetTCPConnection -State Listen -LocalPort 9223 -ErrorAction SilentlyContinue
  if ($l) { "ready: qianwen debug port 9223 is up (pid $(($l | Select-Object -First 1).OwningProcess))"; exit 0 }
}
"timed out waiting for 9223"
exit 1
