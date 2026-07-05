// ================================================================
// Wake-on-LAN + Sleep Prevention
// ================================================================
// Features:
//   - Send WOL magic packet to wake PC from sleep
//   - Prevent PC from sleeping (keep system awake)
//   - Check if PC is awake via ping
//   - Schedule wake timer
// ================================================================

const os = require('os');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const dgram = require('dgram');
const net = require('net');

const execAsync = promisify(exec);

// ================================================================
// Wake-on-LAN: Send Magic Packet
// ================================================================
// The magic packet is a broadcast frame containing 6 bytes of 0xFF
// followed by 16 repetitions of the target MAC address.
function sendWOL(macAddress, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const mac = macAddress.replace(/[^0-9a-fA-F]/g, '');
      if (mac.length !== 12) {
        return resolve({ error: `Invalid MAC address: ${macAddress}. Format: XX:XX:XX:XX:XX:XX` });
      }

      const macBytes = Buffer.from(mac, 'hex');
      const packet = Buffer.alloc(6 + 16 * 6);
      
      // 6 bytes of 0xFF
      for (let i = 0; i < 6; i++) packet[i] = 0xFF;
      // 16 repetitions of MAC
      for (let i = 1; i <= 16; i++) {
        macBytes.copy(packet, i * 6);
      }

      const port = options.port || 9;
      const broadcast = options.broadcast || '255.255.255.255';
      
      const socket = dgram.createSocket('udp4');
      socket.on('error', (err) => {
        socket.close();
        resolve({ error: err.message });
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(packet, 0, packet.length, port, broadcast, (err) => {
          socket.close();
          if (err) return resolve({ error: err.message });
          resolve({ success: true, mac: macAddress, broadcast, port });
        });
      });
    } catch (e) {
      resolve({ error: e.message });
    }
  });
}

// ================================================================
// Get local MAC address
// ================================================================
function getLocalMAC() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac;
      }
    }
  }
  return null;
}

// ================================================================
// Get local IP address
// ================================================================
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// ================================================================
// Ping: Check if host is reachable
// ================================================================
async function ping(host = '127.0.0.1', count = 1) {
  try {
    const flag = process.platform === 'win32' ? '-n' : '-c';
    const { stdout } = await execAsync(`ping ${flag} ${count} -w 2000 ${host}`, { timeout: 5000 });
    const isAlive = stdout.includes('Reply from') || stdout.includes('bytes from') || stdout.includes('TTL');
    const time = stdout.match(/time[=<](\d+)/i);
    return { 
      alive: isAlive, 
      time: time ? parseInt(time[1]) : null,
      output: stdout.split('\n').filter(l => l.trim()).slice(0, 3).join('\n'),
    };
  } catch (e) {
    return { alive: false, time: null, error: e.message };
  }
}

// ================================================================
// Keep system awake (prevent sleep)
// ================================================================
let _sleepPreventionTimer = null;

async function preventSleep(durationMinutes = 60) {
  try {
    if (process.platform === 'win32') {
      // Disable sleep and hibernation via powercfg
      await execAsync('powercfg /change standby-timeout-ac 0', { timeout: 5000 });
      await execAsync('powercfg /change hibernate-timeout-ac 0', { timeout: 5000 });
      await execAsync('powercfg /change monitor-timeout-ac 30', { timeout: 5000 });
      
      // Create a display request to keep system awake
      const psScript = `
        $duration = ${durationMinutes}
        $start = Get-Date
        $wsh = New-Object -ComObject WScript.Shell
        
        while (((Get-Date) - $start).TotalMinutes -lt $duration) {
          # Send a small keypress (Shift key, 100ms) - barely noticeable
          $wsh.SendKeys('+{ESC 0}')
          Start-Sleep -Seconds 60
        }
      `;
      
      const child = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-Command', psScript
      ], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      
      return { 
        success: true, 
        duration: `${durationMinutes} minutes`,
        message: `System will stay awake for ${durationMinutes} minutes (sleep disabled)`,
      };
    } else {
      try {
        await execAsync('caffeinate -d -t ' + (durationMinutes * 60000), { timeout: 3000 });
      } catch (e) {
        return { error: 'Sleep prevention not supported on this platform' };
      }
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ================================================================
// Restore normal sleep settings
// ================================================================
async function allowSleep() {
  try {
    if (process.platform === 'win32') {
      await execAsync('powercfg /change standby-timeout-ac 30', { timeout: 5000 }).catch(() => {});
      await execAsync('powercfg /change hibernate-timeout-ac 60', { timeout: 5000 }).catch(() => {});
      return { success: true, message: 'Normal sleep settings restored' };
    }
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ================================================================
// Get system power status
// ================================================================
async function powerStatus() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'powercfg /query SCHEME_CURRENT SUB_SLEEP 2>&1 | findstr "Setting"',
        { timeout: 5000 }
      );
      const match = stdout.match(/Setting.*\((\d+)\)/);
      const sleepTimeout = match ? parseInt(match[1]) : null;
      return {
        sleepTimeout: sleepTimeout === 0 ? 'Disabled (awake)' : `${sleepTimeout} minutes`,
        mac: getLocalMAC(),
        ip: getLocalIP(),
        hostname: os.hostname(),
      };
    }
    return { mac: getLocalMAC(), ip: getLocalIP(), hostname: os.hostname() };
  } catch (e) {
    return { mac: getLocalMAC(), ip: getLocalIP(), hostname: os.hostname(), error: e.message };
  }
}

module.exports = {
  sendWOL,
  getLocalMAC,
  getLocalIP,
  ping,
  preventSleep,
  allowSleep,
  powerStatus,
};
