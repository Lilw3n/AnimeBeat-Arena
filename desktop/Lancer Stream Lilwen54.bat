@echo off
REM Titre console = date + heure du lancement (preuve de maj)
title Stream Lilwen54 DEV · %date% %time:~0,8%
REM Toujours le dossier du projet (pas le Bureau si ce .bat est copié ailleurs)
cd /d "F:\AnimeBeat Arena\desktop"
if not exist "package.json" (
  echo Introuvable: F:\AnimeBeat Arena\desktop\package.json
  pause
  exit /b 1
)
echo Lancement Stream Lilwen54 depuis:
echo %CD%
echo Date/heure: %date% %time:~0,8%
echo.
call npx --yes electron .
if errorlevel 1 pause
