# Deprecated shim: kept so old notes/commands still work.
# The real work moved to open-web-tabs.ps1 when MiniMax and 智谱 joined the bridge
# (2026-10-26). Two copies of "how to open a tab" is exactly how they drift apart.
#
# ASCII-only (Windows PowerShell 5.1 reads a .ps1 as ANSI).
$ErrorActionPreference = 'Continue'
"note: open-kimi-tab.ps1 now delegates to open-web-tabs.ps1 (all four web models)"
$helper = Join-Path $PSScriptRoot 'open-web-tabs.ps1'
& $helper
exit $LASTEXITCODE
