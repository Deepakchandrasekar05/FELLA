@echo off
set FELLA_HOME=%~dp0..
"%~dp0fella-win.exe"
if %errorlevel% neq 0 (
  echo.
  echo [fella exited with error %errorlevel%]
  pause
)
