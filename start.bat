@echo off
rem Starts Fuobe. Double-click it, or run "start.bat dev" for the dev server (hot reload).
rem Set PORT to use a port other than 3000.
setlocal
cd /d "%~dp0"
title Fuobe
if not defined PORT set PORT=3000

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem pnpm: installed when missing, and updated when it is older than the releases with the security fixes
rem (10.34.5 in 10.x, 11.11.0 in 11.x). package.json names the version the project uses.
set "PNPM_V="
where pnpm >nul 2>nul
if not errorlevel 1 for /f "delims=" %%v in ('pnpm --version 2^>nul') do set "PNPM_V=%%v"
set "PNPM_OK=0"
if defined PNPM_V (
  node -e "const [a,b,c]=process.argv[1].split(/[.-]/).map(Number);process.exit(a>11||(a===11&&b>=11)||(a===10&&(b>34||(b===34&&c>=5)))?0:1)" "%PNPM_V%" && set "PNPM_OK=1"
)
if "%PNPM_OK%"=="0" (
  if defined PNPM_V (echo Updating pnpm %PNPM_V% to 10.34.9...) else (echo Installing pnpm...)
  call npm install -g pnpm@10.34.9 || goto :fail
)

echo Checking dependencies...
call pnpm install --frozen-lockfile --prefer-offline || goto :fail

rem Another app may already be using the port; move to the next free one.
set WANT=%PORT%
for /f %%p in ('node scripts\free-port.mjs %PORT%') do set PORT=%%p
if not "%PORT%"=="%WANT%" echo Port %WANT% is in use by another app, using %PORT% instead.

if /i "%~1"=="dev" (
  call :open
  call pnpm dev -p %PORT%
  goto :eof
)

node scripts\needs-build.mjs
if not errorlevel 1 (
  echo Building Fuobe, this takes a minute or two...
  call pnpm build || goto :fail
)

call :open
echo Fuobe is running at http://localhost:%PORT%  -  close this window or press Ctrl+C to stop.
call pnpm start -p %PORT%
goto :eof

:open
rem Opens the browser once the server answers.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 180; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:%PORT% | Out-Null; break } catch { if ($_.Exception.Response) { break }; Start-Sleep 1 } }; Start-Process http://localhost:%PORT%"
exit /b 0

:fail
echo.
echo Fuobe could not start. See the messages above.
pause
exit /b 1
