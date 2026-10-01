@echo off
rem Lance Night Studio. L'app se place dans la zone de notification (system tray) et demarre l'agent
rem en arriere-plan, sans console. Fermer la fenetre la range dans le tray ; "Quit" (clic droit sur l'icone) arrete tout.
setlocal
cd /d "%~dp0"

rem Un seul studio a la fois : on arrete une instance precedente (agent, interface, serveur Vite orphelin).
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*studio/main.ts*' -or $_.CommandLine -like '*challenge\ui\node_modules*vite*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
taskkill /IM night-studio.exe /F >nul 2>&1

if not exist ".env" (
  echo [!] Fichier .env introuvable : copie .env.example en .env et remplis les cles.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installation des dependances de l'agent...
  call npm install --no-audit --no-fund
)
if not exist "ui\node_modules" (
  echo Installation des dependances de l'interface...
  pushd ui & call npm install --no-audit --no-fund & popd
)

rem Version compilee (npm run tauri build dans ui/) si elle existe, sinon mode dev.
set EXE=ui\src-tauri\target\release\night-studio.exe
if exist "%EXE%" (
  echo Demarrage de Night Studio...
  start "" "%EXE%"
) else (
  echo Demarrage de Night Studio en mode dev...
  start "Night Studio - interface (dev)" /min cmd /c "cd ui && npm run tauri dev"
)

echo.
echo Night Studio tourne dans la zone de notification. Pense a regler la mise en veille de Windows sur "Jamais" pour la nuit.
timeout /t 6 >nul
