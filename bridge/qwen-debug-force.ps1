# Force-stop the Qianwen client and relaunch it with a remote debugging port.
#
# Why force: a polite WM_CLOSE left the main process alive (tray-resident),
# and a second launch is swallowed by the single-instance lock, so the debug
# flag never takes effect. A clean restart requires terminating the old
# processes. The user authorized this restart.
#
# Safety: profile files were backed up beforehand by qwen-debug-restart.ps1;
# nothing is deleted; the app relaunches immediately and reuses its own
# User Data, so the login survives.
$ErrorActionPreference = 'Continue'

# FILL IN: set these to your local Qianwen paths if they are not under %LOCALAPPDATA%.
$exe = "$env:LOCALAPPDATA\Programs\QianwenApp\qianwen.exe"
$userData = "$env:LOCALAPPDATA\Qianwen\User Data"
$portFile = Join-Path $userData 'DevToolsActivePort'

"processes before: " + (@(Get-Process qianwen -ErrorAction SilentlyContinue).Count)

# Stop the whole process tree politely first, then force if it refuses.
foreach ($p in @(Get-Process qianwen -ErrorAction SilentlyContinue)) {
  & taskkill.exe /PID $p.Id /T 2>&1 | Out-Null
}
Start-Sleep -Seconds 5

$still = @(Get-Process qianwen -ErrorAction SilentlyContinue)
if ($still.Count -gt 0) {
  "still alive: $($still.Count) -- forcing"
  foreach ($p in $still) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
  Start-Sleep -Seconds 4
}
"processes after: " + (@(Get-Process qianwen -ErrorAction SilentlyContinue).Count)

# A stale singleton lock would block the relaunch from taking the debug flag.
foreach ($lock in @('SingletonLock', 'SingletonSocket', 'SingletonCookie')) {
  $f = Join-Path $userData $lock
  if (Test-Path $f) {
    # These are reparse points / sockets; Remove-Item on a dead one is safe.
    Remove-Item $f -Force -Recurse -ErrorAction SilentlyContinue
    "cleared stale lock: $lock (present=$([bool](Test-Path $f)))"
  }
}
if (Test-Path $portFile) { Remove-Item $portFile -Force -ErrorAction SilentlyContinue }

"launching with debug port 9223..."
Start-Process -FilePath $exe -ArgumentList @('--remote-debugging-port=9223', '--remote-allow-origins=*')

$found = $null
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $portFile) { $found = Get-Content $portFile -ErrorAction SilentlyContinue; break }
  Start-Sleep -Milliseconds 700
}

if ($found) {
  "DevToolsActivePort: $($found -join ' | ')"
  "CDP endpoint: http://127.0.0.1:$($found[0])/json/list"
} else {
  "STILL NO DevToolsActivePort FILE."
  "processes now: " + (@(Get-Process qianwen -ErrorAction SilentlyContinue).Count)
  "listeners by qianwen:"
  $pids = @(Get-Process qianwen -ErrorAction SilentlyContinue).Id
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $pids -contains $_.OwningProcess } |
    Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String
}
