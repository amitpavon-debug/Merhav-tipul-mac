@echo off
setlocal

if "%1"=="" (
    set /p MACHINE_ID=Machine ID: 
) else (
    set MACHINE_ID=%1
)

echo.
echo 1. START     - up to 10 clients
echo 2. PRO       - up to 30 clients
echo 3. UNLIMITED - no limit
echo.
set /p CHOICE=Choose 1, 2 or 3: 

if "%CHOICE%"=="1" set TIER=START
if "%CHOICE%"=="2" set TIER=PRO
if "%CHOICE%"=="3" set TIER=UNLIMITED

if not defined TIER (
    echo Invalid choice
    pause
    exit /b 1
)

cd /d "%~dp0"
node generate_code.js %MACHINE_ID% %TIER%
pause
