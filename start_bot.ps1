# Start Telegram Commander Bot — Hidden, Persistent
$null = @{}
$env:BOT_TOKEN = '8859542275:AAEBetf9Zpro5oqHK7JQix_ZQOmtB-qY80Y'
$env:OWNER_ID = '7254093696'
$env:OBSIDIAN_TOKEN = 'c51073dcab141de052d2590b2c4fd73d438b86c7959a38f11ff93a062c29a834'
$env:OBSIDIAN_API = 'https://127.0.0.1:27124'
$env:VAULT_PATH = 'C:\Users\user\OneDrive\Документы\Obsidian Vault'

Set-Location -LiteralPath 'C:\Users\user\Projects\telegram-commander'

# Keep the process alive
while ($true) {
    try {
        Write-Host "Starting bot..." -ForegroundColor Green
        node bot.js 2>&1 | ForEach-Object { Write-Host $_ }
    }
    catch {
        Write-Host "Bot crashed: $_" -ForegroundColor Red
    }
    Write-Host "Bot exited. Restarting in 3 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
