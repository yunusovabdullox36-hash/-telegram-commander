// ================================================================
// Obsidian Monitor — PC Activity Logger v2
// ================================================================
// Noutbukda nima bo'layotganini kuzatib, Obsidian ga yozib boradi
// Logs: uptime, processes, CPU/RAM, significant changes, errors
// Auto-archives old logs to prevent file bloat
// ================================================================

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ================================================================
// Config
// ================================================================
const VAULT_PATH = process.env.VAULT_PATH || 'C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault';
const ACTIVITY_LOG_DIR = '_Miya/ActivityLog';
const MONITOR_INTERVAL = 5 * 60 * 1000; // Every 5 minutes
const MAX_LOG_ENTRIES = 200; // Max entries per day before archiving

let _monitorInterval = null;
let _lastSnapshot = null;
let _entryCount = 0;
let _isRunning = false;

// ================================================================
// Path helpers
// ================================================================
function vaultPath(relative) {
  return path.join(VAULT_PATH, relative);
}

function todayLogFile() {
  const date = new Date().toISOString().split('T')[0];
  return `${ACTIVITY_LOG_DIR}/${date}.md`;
}

// ================================================================
// Ensure directory exists
// ================================================================
function ensureDir(dir) {
  const fullPath = vaultPath(dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
}

// ================================================================
// Get system snapshot
// ================================================================
async function getSystemSnapshot() {
  const snapshot = {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    uptime: Math.floor(os.uptime()),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    },
    loadavg: os.loadavg(),
    platform: `${os.type()} ${os.release()}`,
    processes: null,
    activeWindow: null,
  };

  // Get running processes (top memory users) — simple approach
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        `powershell "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 12 ProcessName,Id,@{N='MB';E={[math]::Round($_.WorkingSet/1MB,1)}} | Format-Table -AutoSize | Out-String -Width 200"`,
        { timeout: 8000 }
      );
      snapshot.processes = stdout.trim();
    }
  } catch (e) {
    snapshot.processes = `(process check failed: ${e.message})`;
  }

  // Get active window title — simple PowerShell, no C# needed
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        `powershell "(Get-Process | Where-Object MainWindowTitle -ne '' | Sort-Object StartTime -Descending | Select-Object -First 1).MainWindowTitle"`,
        { timeout: 5000 }
      );
      snapshot.activeWindow = stdout.trim() || '(no window)';
    }
  } catch (e) {
    snapshot.activeWindow = '(unknown)';
  }

  return snapshot;
}

// ================================================================
// Format helpers
// ================================================================
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(' ') || '<1m';
}

// ================================================================
// Archive old log if too large
// ================================================================
function checkAndArchive() {
  try {
    const logFile = vaultPath(todayLogFile());
    if (!fs.existsSync(logFile)) return;

    const content = fs.readFileSync(logFile, 'utf-8');
    const lineCount = content.split('\n').length;

    if (lineCount > MAX_LOG_ENTRIES) {
      // Move to archive
      const archiveFile = logFile.replace('.md', `-archived-${Date.now()}.md`);
      fs.renameSync(logFile, archiveFile);
      _entryCount = 0;
    }
  } catch (e) {
    // Ignore archive errors
  }
}

// ================================================================
// Log system activity to Obsidian
// ================================================================
async function logActivity(force = false) {
  if (_isRunning) return;
  _isRunning = true;

  try {
    const snapshot = await getSystemSnapshot();
    const logFile = todayLogFile();
    ensureDir(ACTIVITY_LOG_DIR);

    const time = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    const memUsedPercent = ((snapshot.memory.used / snapshot.memory.total) * 100).toFixed(1);
    const memUsed = formatBytes(snapshot.memory.used);
    const memTotal = formatBytes(snapshot.memory.total);

    // Start new day log
    if (!fs.existsSync(vaultPath(logFile))) {
      const header = `# 📊 PC Activity Log — ${new Date().toISOString().split('T')[0]}\n\n\`\`\`\nHostname: ${snapshot.hostname}\nPlatform: ${snapshot.platform}\nCPU: ${snapshot.cpuModel} (${snapshot.cpus} cores)\n\`\`\`\n\n## Timeline\n\n`;
      fs.writeFileSync(vaultPath(logFile), header, 'utf-8');
      _entryCount = 0;
    }

    // Check for significant changes
    let significantChanges = [];
    if (_lastSnapshot) {
      const memDiff = Math.abs(snapshot.memory.used - _lastSnapshot.memory.used);
      if (memDiff > 500 * 1024 * 1024) {
        significantChanges.push(`RAM ${memDiff > 0 ? '📈' : '📉'} ${formatBytes(memDiff)}`);
      }
      const uptimeDiff = snapshot.uptime - _lastSnapshot.uptime;
      if (uptimeDiff < 0) {
        // System was restarted
        significantChanges.push('🔄 System restarted');
      }
    }

    // Build log entry
    let entry = `### ⏰ ${time}\n`;
    entry += `- **Uptime:** ${formatDuration(snapshot.uptime)}\n`;
    entry += `- **RAM:** ${memUsed} / ${memTotal} (${memUsedPercent}%)\n`;
    entry += `- **Load:** ${snapshot.loadavg.map(l => l.toFixed(2)).join(', ')}\n`;

    if (snapshot.activeWindow) {
      entry += `- **Active:** \`${snapshot.activeWindow.substring(0, 60)}\`\n`;
    }

    if (significantChanges.length > 0) {
      entry += `- **⚡ ${significantChanges.join(' | ')}**\n`;
    }

    entry += '\n';

    // Append to daily log
    fs.appendFileSync(vaultPath(logFile), entry, 'utf-8');
    _entryCount++;

    // Archive if too many entries
    if (_entryCount >= MAX_LOG_ENTRIES) {
      checkAndArchive();
    }

    _lastSnapshot = snapshot;
  } catch (e) {
    console.error(`[Monitor] Log error: ${e.message}`);
  } finally {
    _isRunning = false;
  }
}

// ================================================================
// Log significant events (process killed, high CPU, etc.)
// ================================================================
async function logEvent(eventType, details) {
  try {
    const logFile = todayLogFile();
    ensureDir(ACTIVITY_LOG_DIR);

    const time = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

    let entry = `### ⏰ ${time} — ⚠️ ${eventType}\n`;
    entry += `> ${details}\n\n`;

    fs.appendFileSync(vaultPath(logFile), entry, 'utf-8');
    _entryCount++;
  } catch (e) {
    console.error(`[Monitor] Event log error: ${e.message}`);
  }
}

// ================================================================
// Log bot actions
// ================================================================
async function logBotAction(action, result) {
  try {
    const logFile = todayLogFile();
    ensureDir(ACTIVITY_LOG_DIR);

    const time = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

    let entry = `### ⏰ ${time} — 🤖 Bot Action\n`;
    entry += `> **${action}**: ${result}\n\n`;

    fs.appendFileSync(vaultPath(logFile), entry, 'utf-8');
    _entryCount++;
  } catch (e) {
    console.error(`[Monitor] Bot action log error: ${e.message}`);
  }
}

// ================================================================
// Get today's activity summary
// ================================================================
function getTodaySummary() {
  try {
    const logFile = vaultPath(todayLogFile());
    if (!fs.existsSync(logFile)) return '*No activity logged yet today.*';
    const content = fs.readFileSync(logFile, 'utf-8');
    // Return last 20 lines
    const lines = content.split('\n');
    const lastLines = lines.slice(-20);
    return lastLines.join('\n');
  } catch (e) {
    return `*Error reading log:* ${e.message}`;
  }
}

// ================================================================
// Start monitoring
// ================================================================
function startMonitoring() {
  if (_monitorInterval) {
    console.log('[Monitor] Already running');
    return;
  }

  console.log('[Monitor] Starting PC activity monitoring...');
  console.log(`[Monitor] Logging to: obsidian://${vaultPath(ACTIVITY_LOG_DIR)}`);
  console.log(`[Monitor] Interval: ${MONITOR_INTERVAL / 1000}s`);

  ensureDir(ACTIVITY_LOG_DIR);

  // Check and archive on startup
  checkAndArchive();

  // Log immediately on start
  logActivity(true);

  // Then every 5 minutes
  _monitorInterval = setInterval(() => {
    logActivity();
  }, MONITOR_INTERVAL);
}

// ================================================================
// Stop monitoring
// ================================================================
function stopMonitoring() {
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
    console.log('[Monitor] Stopped');
  }
}

// ================================================================
// Get current monitor status
// ================================================================
function getMonitorStatus() {
  return {
    running: _monitorInterval !== null,
    interval: `${MONITOR_INTERVAL / 1000}s`,
    logFile: todayLogFile(),
    entryCount: _entryCount,
    lastCheck: _lastSnapshot?.timestamp || null,
    uptime: _lastSnapshot ? formatDuration(_lastSnapshot.uptime) : 'N/A',
  };
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  logActivity,
  logEvent,
  logBotAction,
  getTodaySummary,
  getMonitorStatus,
};
