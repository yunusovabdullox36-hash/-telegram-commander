// ============================================================
// Telegram Commander — Windows Service Installer (PowerShell)
// ============================================================
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BOT_DIR = __dirname;
const BOT_SCRIPT = path.join(BOT_DIR, 'bot.js');

console.log('========================================');
console.log('  Telegram Commander — Windows Service');
console.log('========================================\n');

// 1. Tekshirish
if (!fs.existsSync(BOT_SCRIPT)) {
  console.error('❌ bot.js topilmadi:', BOT_SCRIPT);
  process.exit(1);
}
console.log('✅ bot.js OK');

// 2. PowerShell orqali Task Scheduler yaratish
const psScript = `
$taskName = "TelegramCommanderBot"
$nodePath = (Get-Command node).Source
$botScript = "${BOT_SCRIPT.replace(/\\/g, '\\\\')}"
$workDir = "${BOT_DIR.replace(/\\/g, '\\\\')}"

# Eski taskni o'chirish
try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

# Yangi task yaratish
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "\\"$botScript\\"" -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings
Register-ScheduledTask $taskName -InputObject $task -Force

Write-Output "Task created: $taskName"
Write-Output "Node: $nodePath"
Write-Output "Script: $botScript"
Write-Output "Trigger: AtLogOn"
`;

try {
  const result = execSync(`powershell -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
    timeout: 15000
  });
  console.log(result);
  console.log('✅ Windows Task Scheduler: Created');
  console.log('   Nomi: TelegramCommanderBot');
  console.log('   Ishga tushadi: User logon da');
} catch (e) {
  console.log('⚠️  PowerShell Task yaratishda xatolik:', e.message);
  console.log('\n📋 Qo\'lda o\'rnatish:');
  console.log('   1. O\'ng tugma -> "install-service-as-admin.bat"');
  console.log('   2. "Run as Administrator"');
}

console.log('\n========================================');
console.log('  ✅ O\'RNATILDI!');
console.log('========================================');
console.log('\n📋 Bot @rey_asistent_bot ga xabar yozib ko\'ring!');
console.log('   /status — tizim holati');
console.log('   /help — yordam');
