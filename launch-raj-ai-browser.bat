@echo off
setlocal enabledelayedexpansion
title Navi AI Browser - Profile: Raj

echo ======================================================================
echo           NAVI ZERO-API-KEY AI BROWSER LAUNCHER
echo                 Target Profile: raj (Profile 4)
echo ======================================================================
echo.

set CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe
if not exist "!CHROME_BIN!" set CHROME_BIN=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
if not exist "!CHROME_BIN!" set "CHROME_BIN=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME_BIN!" set "CHROME_BIN=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if not exist "!CHROME_BIN!" (
    echo [ERROR] Google Chrome was not found on this system!
    echo Please install Google Chrome or update the path in this script.
    pause
    exit /b 1
)

:: Check if Chrome is already running
tasklist /fi "imagename eq chrome.exe" 2>nul | find /i "chrome.exe" >nul
if not errorlevel 1 (
    echo [NOTICE] Google Chrome is currently running.
    echo In Chrome, remote debugging (port 9222) MUST be enabled when the browser starts.
    echo.
    set /p RESTART="Do you want to restart Chrome with debugging port 9222 enabled? (Y/N, default Y): "
    if "!RESTART!"=="" set RESTART=Y
    if /i "!RESTART!"=="Y" (
        echo Gracefully restarting Chrome...
        taskkill /im chrome.exe /f >nul 2>&1
        timeout /t 2 >nul
    ) else (
        echo Continuing without restarting...
    )
)

echo.
echo Launching Chrome with Profile: raj (Profile 4)...
echo CDP Debugging Port: 9222
echo Tabs: ChatGPT, Claude, Gemini, DeepSeek
echo.

start "Navi AI Browser" "!CHROME_BIN!" --profile-directory="Profile 4" --remote-debugging-port=9222 "https://chatgpt.com" "https://claude.ai" "https://gemini.google.com" "https://chat.deepseek.com"

echo ======================================================================
echo [SUCCESS] Chrome profile 'raj' is now OPEN on your screen!
echo.
echo  • Your logged-in sessions in 'raj' are automatically active.
echo  • You can query any AI anytime directly from your terminal:
echo      navi ask "Write a Python script" --provider chatgpt
echo      navi ask "Explain this code" --provider claude
echo      navi ask "Deep research this" --provider deepseek
echo ======================================================================
echo.
timeout /t 5

