@echo off
if "%1"=="" ( set /p MACHINE_ID="קוד מחשב: " ) else ( set MACHINE_ID=%1 )
cd /d "%~dp0"
node generate_reset.js %MACHINE_ID%
pause
