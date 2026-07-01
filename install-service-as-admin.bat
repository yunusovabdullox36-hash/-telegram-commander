@echo off
title Telegram Commander — Service Install (Admin)
cd /d "%~dp0"

echo ========================================
echo   Telegram Commander — Service Install
echo   ADMIN huquqida ishga tushirish...
echo ========================================
echo.

:: O'zini admin huquqida qayta ishga tushirish
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Ushbu skriptni ADMIN huquqida ishga tushirish kerak.
    echo.
    echo Avtomatik qayta ishga tushirish...
    timeout /t 3 /nobreak >nul
    powershell Start-Process -FilePath "%~f0" -Verb RunAs
    exit /b
)

:: Admin huquqida ishlayapti
echo [OK] Admin huquqi tasdiqlandi
echo.

:: PowerShell skriptini ishga tushirish
powershell -ExecutionPolicy Bypass -File "install-service-admin.ps1"

pause
