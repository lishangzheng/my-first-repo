@echo off
REM ASCII-only filename and content on purpose: cmd parses .bat bytes using the
REM OEM code page, so a CJK filename or body can be mangled into "path not
REM found". The Chinese name the user sees lives on the desktop shortcut.
REM
REM All user-facing Chinese text is inside launch-bridge.ps1 (read from
REM launcher-strings.json and printed on a UTF-8 console).
setlocal
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-bridge.ps1" %*
endlocal
