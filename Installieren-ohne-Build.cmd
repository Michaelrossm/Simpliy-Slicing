@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~1"
if not defined ROOT (
  echo Ordner mit frontend und src-tauri angeben, z.B. T:\Simply slicer\Projekt
  set /p "ROOT=Quellcode-Ordner: "
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Update.ps1" -ProjectRoot "%ROOT%"
echo.
pause
