@echo off
title AnimeBeat Live Hub v1.2.0 (DEV)
cd /d "%~dp0"
echo.
echo  AnimeBeat Live Hub v1.2.0  [DEV = code source]
echo  Dossier: %CD%
echo  Ne pas utiliser le raccourci "AnimeBeat Live Hub" (installé, souvent obsolete).
echo.
npx electron .
if errorlevel 1 pause
