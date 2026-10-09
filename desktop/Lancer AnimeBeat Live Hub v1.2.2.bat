@echo off
title AnimeBeat Live Hub v1.2.2 (DEV)
cd /d "%~dp0"
echo AnimeBeat Live Hub v1.2.2 [DEV]
npx electron .
if errorlevel 1 pause
