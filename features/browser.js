// ================================================================
// Browser Control — Chrome, Edge, Google Search, Navigation
// ================================================================
// Natural language controlled via AI function calling
// ================================================================

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ================================================================
// Find browser executable path
// ================================================================
function findBrowser() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const fs = require('fs');
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ================================================================
// Open browser with URL
// ================================================================
async function openBrowser(url = 'https://google.com') {
  const browser = findBrowser();
  if (!browser) return { error: 'Browser not found on system' };
  
  // Ensure URL has protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  try {
    // Start browser in new window
    const child = require('child_process').spawn(browser, [
      `--new-window`, url
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { success: true, browser: require('path').basename(browser), url };
  } catch (e) {
    return { error: e.message };
  }
}

// ================================================================
// Google Search
// ================================================================
async function googleSearch(query) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
  return openBrowser(searchUrl);
}

// ================================================================
// YouTube Search/Open
// ================================================================
async function youtubeSearch(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return openBrowser(url);
}

// ================================================================
// Close all browser instances
// ================================================================
async function closeBrowser(browserName = 'chrome') {
  try {
    const name = browserName.toLowerCase();
    const tryKill = async (exe) => {
      // First try graceful close (no /F)
      try { await execAsync(`taskkill /IM ${exe} 2>nul || exit 0`); }
      catch (e) {}
      // Give it 2 seconds, then force kill if still running
      await new Promise(r => setTimeout(r, 2000));
      try { await execAsync(`taskkill /F /IM ${exe} 2>nul || exit 0`); }
      catch (e) {}
    };
    if (name.includes('chrome') || name.includes('google')) {
      await tryKill('chrome.exe');
      return { success: true, message: 'Chrome closed' };
    } else if (name.includes('edge') || name.includes('msedge')) {
      await tryKill('msedge.exe');
      return { success: true, message: 'Edge closed' };
    } else {
      await tryKill('chrome.exe');
      await tryKill('msedge.exe');
      return { success: true, message: 'All browsers closed' };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ================================================================
// Get browser process status
// ================================================================
async function browserStatus() {
  try {
    const { stdout } = await execAsync(
      'powershell "Get-Process chrome,msedge -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,@{N=\'MB\';E={[math]::Round($_.WorkingSet/1MB,1)}} | Format-Table -AutoSize | Out-String"',
      { timeout: 5000 }
    );
    const lines = stdout.trim().split('\n').filter(l => l.trim());
    if (lines.length <= 3) return { open: false, message: 'No browser windows open' };
    return { open: true, processes: lines.slice(3).join('\n') };
  } catch (e) {
    return { open: false, message: 'No browser running' };
  }
}

// ================================================================
// Browse to a specific site (shortcut for common sites)
// ================================================================
async function browseTo(site) {
  const shortcuts = {
    'github': 'https://github.com',
    'gmail': 'https://mail.google.com',
    'youtube': 'https://youtube.com',
    'chatgpt': 'https://chat.openai.com',
    'claude': 'https://claude.ai',
    'chat': 'https://chat.openai.com',
    'google': 'https://google.com',
    'stackoverflow': 'https://stackoverflow.com',
    'reddit': 'https://reddit.com',
    'x': 'https://x.com',
    'twitter': 'https://x.com',
    'render': 'https://dashboard.render.com',
    'vercel': 'https://vercel.com',
    'netflix': 'https://netflix.com',
    'spotify': 'https://open.spotify.com',
    'telegram': 'https://web.telegram.org',
    'whatsapp': 'https://web.whatsapp.com',
    'obsidian': 'obsidian://open',
  };
  
  const url = shortcuts[site.toLowerCase()] || site;
  return openBrowser(url);
}

module.exports = {
  openBrowser,
  googleSearch,
  youtubeSearch,
  closeBrowser,
  browserStatus,
  browseTo,
  findBrowser,
};
