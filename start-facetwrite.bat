@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-facetwrite.ps1"
if errorlevel 1 (
  echo.
  echo FacetWrite launcher exited with an error.
  pause
)
endlocal
