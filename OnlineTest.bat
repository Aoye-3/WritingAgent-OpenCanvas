@echo off
setlocal
cd /d "%~dp0"

echo Starting OpenCanvas Cloudflare remote test launcher...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-cloudflare-tunnel-appshell.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo OpenCanvas Cloudflare remote test launcher exited with an error. Exit code: %EXIT_CODE%
) else (
  echo Keep this window open while you copy the remote Cloudflare URL above.
  echo The tunnel keeps running until you run the printed Stop-Process command.
)
echo.
pause

endlocal
exit /b %EXIT_CODE%
