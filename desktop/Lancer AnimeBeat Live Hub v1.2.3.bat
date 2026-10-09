@echo off
title AnimeBeat Live Hub v1.2.3 (DEV)
cd /d "%~dp0"
npx electron .
if errorlevel 1 pause
