@echo off
rem Lance Night Studio : l'agent (fenetre "Night Studio - agent") puis l'interface Tauri.
rem Double-cliquer ce fichier. Fermer la fenetre de l agent arrete le studio.
setlocal
cd /d "%~dp0"

rem Un seul studio a la fois : on arrete une instance precedente (agent, interface).
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*studio/main.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
taskkill /IM night-studio.exe /F >nul 2>&1
rem Le serveur Vite de l'interface survit parfois a la fenetre et bloquerait le port 5199.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*challenge\ui\node_modules*vite*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

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

echo Demarrage de l'agent...
start "Night Studio - agent" cmd /k "npm start"

rem Laisser l'API (port 8787) demarrer avant l'interface.
timeout /t 4 /nobreak >nul

echo Demarrage de l'interface...
start "Night Studio - interface" /min cmd /c "cd ui && npm run tauri dev"

echo.
echo Night Studio est lance. Pense a regler la mise en veille de Windows sur "Jamais" pour la nuit.
timeout /t 6 >nul
