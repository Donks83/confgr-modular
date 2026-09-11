@echo off
rem Double-click this to put the bundle on the internet with working AR.
rem Everything it does is in tools\start-ar-host.ps1, including why.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\start-ar-host.ps1" %*
