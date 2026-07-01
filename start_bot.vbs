' Telegram Commander v3.0 — Windows Startup
' Starts the bot completely hidden (no windows visible)
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""& { $env:BOT_TOKEN='8859542275:AAEBetf9Zpro5oqHK7JQix_ZQOmtB-qY80Y'; $env:OWNER_ID='7254093696'; $env:OBSIDIAN_TOKEN='c51073dcab141de052d2590b2c4fd73d438b86c7959a38f11ff93a062c29a834'; $env:OBSIDIAN_API='https://127.0.0.1:27124'; $env:VAULT_PATH='C:\Users\user\OneDrive\Документы\Obsidian Vault'; Set-Location 'C:\Users\user\Projects\telegram-commander'; while(1){try{node bot.js}catch{}; Start-Sleep 3} }""", 0, False
