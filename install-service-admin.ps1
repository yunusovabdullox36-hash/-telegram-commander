# ============================================================
# Telegram Commander — Admin huquq bilan Task Scheduler o'rnatish
# ============================================================
# BU SKRIPTNI ADMIN HUQUQIDA ISHGA TUSHIRING:
#   1. O'ng tugma → "Run with PowerShell"
#   2. Yoki "Run as Administrator"
# ============================================================

$ErrorActionPreference = "Stop"
$taskName = "TelegramCommanderBot"
$nodePath = (Get-Command node).Source
$botScript = "C:\Users\user\Projects\telegram-commander\bot.js"
$workDir = "C:\Users\user\Projects\telegram-commander"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Telegram Commander — Service Install" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Admin tekshirish
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "❌ Bu skript ADMIN huquqida ishlamayapti!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Iltimos:" -ForegroundColor Yellow
    Write-Host "  1. PowerShell ni Admin sifatida oching" -ForegroundColor Yellow
    Write-Host "  2. CD: C:\Users\user\Projects\telegram-commander\" -ForegroundColor Yellow
    Write-Host "  3. Run: .\install-service-admin.ps1" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Admin huquqi: OK" -ForegroundColor Green

# 2. Bot fayli borligini tekshirish
if (-not (Test-Path $botScript)) {
    Write-Host "❌ bot.js topilmadi: $botScript" -ForegroundColor Red
    exit 1
}
Write-Host "✅ bot.js: OK" -ForegroundColor Green
Write-Host "   Node: $nodePath" -ForegroundColor Gray
Write-Host "   Script: $botScript" -ForegroundColor Gray

# 3. Node.js borligini tekshirish
if (-not $nodePath) {
    Write-Host "❌ Node.js topilmadi" -ForegroundColor Red
    exit 1
}

# 4. Eski taskni o'chirish
Write-Host "`n🔄 Eski task o'chirilmoqda..." -ForegroundColor Yellow
try {
    schtasks /DELETE /TN $taskName /F 2>&1 | Out-Null
    Write-Host "   Eski task o'chirildi" -ForegroundColor Gray
} catch {
    Write-Host "   Task mavjud emas — davom etamiz" -ForegroundColor Gray
}

# 5. Yangi task yaratish (SYSTEM, boot, highest)
Write-Host "`n🔧 Yangi task yaratilmoqda..." -ForegroundColor Yellow
$taskCmd = "`"$nodePath`" `"$botScript`""

try {
    schtasks /CREATE `
        /TN $taskName `
        /TR $taskCmd `
        /SC ONSTART `
        /DELAY 0000:30 `
        /RL HIGHEST `
        /RU SYSTEM `
        /IT `
        /F 2>&1 | ForEach-Object { Write-Host "   $_" }

    Write-Host ""
    Write-Host "✅ Task yaratildi!" -ForegroundColor Green
    Write-Host "   Nomi: $taskName" -ForegroundColor White
    Write-Host "   Ishga tushadi: Windows boot da (30 sekund delay)" -ForegroundColor White
    Write-Host "   Hisob: SYSTEM" -ForegroundColor White
    Write-Host "   Daraja: HIGHEST" -ForegroundColor White
} catch {
    Write-Host "❌ Task yaratishda xatolik:" -ForegroundColor Red
    Write-Host "   $_" -ForegroundColor Red
    exit 1
}

# 6. Taskni tekshirish
Write-Host "`n📋 Task tekshirilmoqda..." -ForegroundColor Yellow
schtasks /QUERY /TN $taskName /V /FO LIST 2>&1 | Select-Object -First 10

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ✅ O'RNATILDI!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tayyor! Endi noutbukni qayta ishga tushiring." -ForegroundColor White
Write-Host "Bot avtomat ishga tushadi: @rey_asistent_bot" -ForegroundColor White
