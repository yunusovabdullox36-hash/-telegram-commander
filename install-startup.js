// ================================================================
// Telegram Commander — Auto-Start Installer
// ================================================================
// 1. Windows Startup papkasiga yorliq qo'shadi
// 2. Task Scheduler ga task yaratadi
// 3. Bot noutbuk yoqilganda avtomatik ishga tushadi
// ================================================================

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BOT_DIR = __dirname;
const BOT_SCRIPT = path.join(BOT_DIR, 'bot.js');
const STARTUP_DIR = path.join(
  process.env.APPDATA || 'C:\\Users\\user\\AppData\\Roaming',
  'Microsoft\\Windows\\Start Menu\\Programs\\Startup'
);
const VBS_FILE = path.join(STARTUP_DIR, 'TelegramCommanderBot.vbs');
const TASK_NAME = 'TelegramCommanderBot';

console.log('========================================');
console.log('  Telegram Commander — Auto-Start Setup');
console.log('========================================\n');

// 1. Check bot.js exists
if (!fs.existsSync(BOT_SCRIPT)) {
  console.error('❌ bot.js not found:', BOT_SCRIPT);
  process.exit(1);
}
console.log('✅ bot.js OK');

// 2. Create VBS launcher in Windows Startup folder
console.log('\n📁 Creating Windows Startup launcher...');
console.log(`   Target: ${VBS_FILE}`);

const vbsContent = `' Telegram Commander Bot v5.0 — Auto Start
' Rey ning noutbuki yoqilganda bot avtomatik ishga tushadi
Dim sh, botFolder
botFolder = "${BOT_DIR.replace(/\\/g, '\\\\')}"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = botFolder
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""& { $env:BOT_TOKEN='8859542275:AAEBetf9Zpro5oqHK7JQix_ZQOmtB-qY80Y'; $env:OWNER_ID='7254093696'; $env:VAULT_PATH='C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault'; Set-Location '" + BOT_DIR.replace(/\\/g, '\\\\') + "'; while(1){try{node bot.js}catch{}; Start-Sleep 3} }"""", 0, False
`;

try {
  fs.writeFileSync(VBS_FILE, vbsContent, 'utf-8');
  console.log('✅ Windows Startup script created!');
  console.log(`   File: ${VBS_FILE}`);
  console.log('   Bot starts automatically when laptop turns on!');
} catch (e) {
  console.log(`⚠️  Could not write to Startup folder: ${e.message}`);
  console.log('   Trying alternative auto-start method...');
}

// 3. Create Task Scheduler task (admin may be needed)
console.log('\n📋 Creating Task Scheduler task...');

const psScript = `
$taskName = "${TASK_NAME}"
$nodePath = (Get-Command node).Source
$botScript = "${BOT_SCRIPT.replace(/\\\\/g, '\\\\\\\\')}"
$workDir = "${BOT_DIR.replace(/\\\\/g, '\\\\\\\\')}"

# Remove old task
try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

# Create new task
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "\\"$botScript\\"" -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings
Register-ScheduledTask $taskName -InputObject $task -Force

Write-Output "Task created: $taskName"
Write-Output "Node: $nodePath"
Write-Output "Script: $botScript"
Write-Output "Trigger: AtLogOn"
Write-Output "Restart: On failure, every 1 minute"
`;

try {
  const result = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
    { encoding: 'utf-8', maxBuffer: 1024 * 1024, timeout: 20000 }
  );
  console.log(`✅ Task Scheduler: ${TASK_NAME}`);
  console.log(result);
} catch (e) {
  console.log('⚠️  Task Scheduler failed (may need admin rights):');
  console.log(`   ${e.message}`);
  console.log('\n   Alternative:');
  console.log(`   1. VBS file is in Startup folder: ${VBS_FILE}`);
  console.log('   2. Or run: npm run install-service (as admin)');
}

// 4. Summary
console.log('\n========================================');
console.log('  ✅ AUTO-START SETUP COMPLETE!');
console.log('========================================\n');
console.log('📌 Bot @rey_asistent_bot ishga tushadi:');
console.log('   - Noutbuk yoqilganda (via Startup folder)');
console.log('   - Windows ga kirganda (via Task Scheduler)');
console.log('   - Agar crash bo\'lsa, avtomat qayta ishga tushadi');
console.log('   - PC monitoring aktiv!');
console.log('\n📋 Test: @rey_asistent_bot ga xabar yozing!');
