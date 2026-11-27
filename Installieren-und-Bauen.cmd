@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~1"
if not defined ROOT (
  echo Ordner mit frontend und src-tauri angeben, z.B. T:\Simply slicer\Projekt
  set /p "ROOT=Quellcode-Ordner: "
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Update.ps1" -ProjectRoot "%ROOT%"
if errorlevel 1 (echo Update abgebrochen.&pause&exit /b 1)
if not exist "%ROOT%\Build-Windows.cmd" (echo Build-Windows.cmd nicht gefunden.&pause&exit /b 1)
call "%ROOT%\Build-Windows.cmd"
