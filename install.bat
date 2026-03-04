@echo off
REM Fare Hound - Windows Install Script

echo ========================================
echo   Fare Hound - Flight Price API Installer
echo ========================================
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js not found. Please install Node.js 20+ from https://nodejs.org
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

echo Installing dependencies...
call npm install

echo.
echo Installing Playwright browsers...
call npx playwright install chromium

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Starting API on http://localhost:3001
echo Press Ctrl+C to stop
echo.

node flight_api.js
