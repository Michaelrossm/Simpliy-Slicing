@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%" || (echo Arbeitsverzeichnis nicht erreichbar.& pause & exit /b 1)
where cargo >nul 2>&1 || (echo FEHLT: Rust/Cargo. Installation ueber https://rustup.rs/ & pause & exit /b 2)
where npm >nul 2>&1 || (echo FEHLT: Node.js/npm. & pause & exit /b 2)
if not exist "node_modules\@tauri-apps\cli" (
  echo Tauri-Buildwerkzeuge fehlen. Bitte zuerst bewusst "npm install" ausfuehren.
  pause
  exit /b 2
)
echo Starte Simpliy Slicing als native Tauri Desktop-Anwendung ...
call npm run dev
if errorlevel 1 (echo Tauri-Start fehlgeschlagen. Rust, Visual Studio C++ Build Tools und WebView2 pruefen. & pause & exit /b 1)
