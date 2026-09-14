@echo off
rem Put the configurator on a permanent address. See tools\deploy-netlify.ps1
rem for what it does and NETLIFY.md for the accounts you need first.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\deploy-netlify.ps1" %*
