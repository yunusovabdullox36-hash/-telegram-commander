// ================================================================
// PC Remote Control — Local mode only
// ================================================================
// Commands: /cmd, /ps, /kill, /shutdown, /reboot, /lock, /sleep,
//           /pcstatus, /clipboard
// ================================================================

const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

let isScreenshotAvailable = false;
let screenshotModule = null;

// Try to load screenshot module
try {
  screenshotModule = require('screenshot-desktop');
  isScreenshotAvailable = true;
} catch (e) {
  // Optional dependency
}

// ================================================================
// CORE: Execute shell command
// ================================================================
async function runCommand(command, timeout = 30000) {
  try {
    const { stdout, stderr } = await execPromise(command, {
      timeout,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    const output = stdout + (stderr ? '\n⚠️ STDERR:\n' + stderr : '');
    return output.trim() || '(no output)';
  } catch (e) {
    if (e.stdout || e.stderr) {
      return (e.stdout || '') + (e.stderr ? '\n⚠️ ' + e.stderr : '') || e.message;
    }
    return `❌ Error: ${e.message}`;
  }
}

// ================================================================
// Screenshot
// ================================================================
async function takeScreenshot() {
  if (!isScreenshotAvailable) throw new Error('screenshot-desktop not available');
  const img = await screenshotModule({ format: 'png' });
  return img; // Buffer
}

// ================================================================
// Process Management
// ================================================================
async function listProcesses(filter) {
  if (process.platform === 'win32') {
    const cmd = filter
      ? `Get-Process | Where-Object { $_.ProcessName -like '*${filter}*' } | Select-Object Id, ProcessName, @{N='CPU(s)';E={[math]::Round($_.CPU, 1)}}, @{N='MB';E={[math]::Round($_.WorkingSet/1MB, 1)}} | Format-Table -AutoSize`
      : `Get-Process | Select-Object Id, ProcessName, @{N='CPU(s)';E={[math]::Round($_.CPU, 1)}}, @{N='MB';E={[math]::Round($_.WorkingSet/1MB, 1)}} | Sort-Object -Property MB -Descending | Select-Object -First 30 | Format-Table -AutoSize`;
    return runCommand(cmd, 10000);
  } else {
    const cmd = filter
      ? `ps aux | grep -i "${filter}" | grep -v grep`
      : `ps aux --sort=-%mem | head -30`;
    return runCommand(cmd, 10000);
  }
}

async function killProcess(target) {
  if (process.platform === 'win32') {
    // Try by PID first, then by name
    if (/^\d+$/.test(target)) {
      return runCommand(`Stop-Process -Id ${target} -Force -ErrorAction Stop`, 5000);
    } else {
      return runCommand(`Stop-Process -Name "${target}" -Force -ErrorAction Stop`, 5000);
    }
  } else {
    if (/^\d+$/.test(target)) {
      return runCommand(`kill -9 ${target}`, 5000);
    } else {
      return runCommand(`pkill -9 -f "${target}"`, 5000);
    }
  }
}

// ================================================================
// System Control
// ================================================================
async function lockWorkstation() {
  if (process.platform === 'win32') {
    // Lock Windows
    return runCommand('rundll32.exe user32.dll,LockWorkStation', 5000);
  } else if (process.platform === 'linux') {
    return runCommand('gnome-screensaver-command -l || loginctl lock-session', 5000);
  } else {
    return runCommand('pmset displaysleepnow', 5000);
  }
}

async function sleepMode() {
  if (process.platform === 'win32') {
    return runCommand('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', 5000);
  } else if (process.platform === 'linux') {
    return runCommand('systemctl suspend', 5000);
  } else {
    return runCommand('pmset sleepnow', 5000);
  }
}

async function shutdownPC(delaySeconds = 0) {
  if (process.platform === 'win32') {
    return runCommand(`shutdown /s /t ${delaySeconds} /c "Telegram Commander initiated shutdown"`, 5000);
  } else {
    return runCommand(`shutdown -h +${Math.ceil(delaySeconds / 60)}`, 5000);
  }
}

async function rebootPC(delaySeconds = 0) {
  if (process.platform === 'win32') {
    return runCommand(`shutdown /r /t ${delaySeconds} /c "Telegram Commander initiated reboot"`, 5000);
  } else {
    return runCommand(`shutdown -r +${Math.ceil(delaySeconds / 60)}`, 5000);
  }
}

async function cancelShutdown() {
  if (process.platform === 'win32') {
    return runCommand('shutdown /a', 5000);
  } else {
    return runCommand('shutdown -c', 5000);
  }
}

// ================================================================
// PC Status
// ================================================================
async function getPCStatus() {
  const hostname = os.hostname();
  const platform = `${os.type()} ${os.release()} (${os.arch()})`;
  const uptime = Math.floor(os.uptime());
  const uptimeStr = `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
  
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = ((usedMem / totalMem) * 100).toFixed(1);
  
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Unknown';
  const cpuCores = cpus.length;
  
  // CPU load (quick approximation)
  let cpuLoad = 'N/A';
  try {
    if (process.platform === 'win32') {
      const result = await runCommand('Get-CimInstance Win32_Processor | Select-Object -ExpandProperty LoadPercentage', 5000);
      cpuLoad = result.match(/\d+/)?.[0] || 'N/A';
    } else {
      const [total, idle] = await new Promise((resolve) => {
        const cpus1 = os.cpus().map(c => c.times);
        setTimeout(() => {
          const cpus2 = os.cpus().map(c => c.times);
          const totalDiff = cpus2.reduce((s, c, i) => s + Object.values(c).reduce((a, b) => a + b, 0) - Object.values(cpus1[i]).reduce((a, b) => a + b, 0), 0);
          const idleDiff = cpus2.reduce((s, c, i) => s + c.idle - cpus1[i].idle, 0);
          resolve([totalDiff, idleDiff]);
        }, 100);
      });
      cpuLoad = total > 0 ? ((1 - idle / total) * 100).toFixed(1) : 'N/A';
    }
  } catch (e) {}
  
  return {
    hostname,
    platform,
    uptime: uptimeStr,
    cpu: `${cpuModel} (${cpuCores} cores)`,
    cpuLoad: `${cpuLoad}%`,
    memory: `${(usedMem / 1024 / 1024 / 1024).toFixed(1)}GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)}GB (${memPercent}%)`,
    screenshot: isScreenshotAvailable,
  };
}

// ================================================================
// Clipboard
// ================================================================
async function readClipboard() {
  if (process.platform === 'win32') {
    try {
      const result = await runCommand('Get-Clipboard', 5000);
      return result;
    } catch (e) {
      // Fallback: try powershell -command
      return runCommand('powershell -command "Get-Clipboard"', 5000);
    }
  } else if (process.platform === 'linux') {
    return runCommand('xclip -o -selection clipboard', 5000);
  } else {
    return runCommand('pbpaste', 5000);
  }
}

// ================================================================
// Webcam
// ================================================================
async function captureWebcam() {
  try {
    // Try to use ffmpeg to capture webcam
    const tmpFile = path.join(os.tmpdir(), `webcam-${Date.now()}.jpg`);
    await execPromise(
      `ffmpeg -f dshow -i video="USB Camera" -vframes 1 -q:v 2 "${tmpFile}" -y`,
      { timeout: 10000 }
    );
    const img = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    return img;
  } catch (e) {
    // Try Windows.Media.Capture (UWP) fallback
    try {
      const result = await execPromise(
        `powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::DoEvents(); $c = New-Object -ComObject WIA.CommonDialog; $i = $c.ShowCapture(); if ($i) { $f = '$env:TEMP\\webcam-$([guid]::NewGuid()).jpg'; $i.SaveFile($f); Write-Output $f }"`,
        { timeout: 15000 }
      );
      if (result.stdout.trim()) {
        const imgPath = result.stdout.trim();
        const img = fs.readFileSync(imgPath);
        fs.unlinkSync(imgPath);
        return img;
      }
    } catch (e2) {}
    throw new Error('Webcam not available');
  }
}

// ================================================================
// Wrapper for cloud mode (queues commands)
// ================================================================
function queueCloudCommand(outboxQueue, text, replyTo) {
  outboxQueue.push({ type: 'text', text, replyTo });
}

module.exports = {
  runCommand,
  takeScreenshot,
  isScreenshotAvailable,
  listProcesses,
  killProcess,
  lockWorkstation,
  sleepMode,
  shutdownPC,
  rebootPC,
  cancelShutdown,
  getPCStatus,
  readClipboard,
  captureWebcam,
  queueCloudCommand,
};
