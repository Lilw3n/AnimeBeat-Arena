@echo off
title AnimeBeat Live Hub v1.2.1 (DEV)
cd /d "%~dp0"
echo.
echo  AnimeBeat Live Hub v1.2.1  [DEV = code source]
echo  Dossier: %CD%
echo.
npx electron .
if errorlevel 1 pause
