@echo off
setlocal
cd /d "%~dp0"
where cargo >nul 2>&1 || (echo Rust/Cargo fehlt. & pause & exit /b 2)
where npm >nul 2>&1 || (echo Node/npm fehlt. & pause & exit /b 2)
if not exist "node_modules\@tauri-apps\cli" (echo Zuerst npm install ausfuehren. & pause & exit /b 2)
call npm run build
if errorlevel 1 (echo Build fehlgeschlagen. & pause & exit /b 1)
echo Fertig. Ergebnis unter src-tauri\target\release\bundle\
pause
