// ================================================================
// Cloud Sync v1.0 — Cloud Bot ↔ Obsidian Bridge
// ================================================================
// This runs on Rey's laptop.
// It bridges the cloud Telegram bot with the local Obsidian vault.
// 
// 1. Polls cloud bot API for new messages → writes to Obsidian inbox
// 2. Watches Obsidian outbox for new responses → sends via cloud bot API
// 3. Runs silently in background (Windows Task Scheduler)
// ================================================================

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ================================================================
// Config
// ================================================================
const CONFIG = {
  // Cloud bot URL (Render)
  cloudApi: process.env.CLOUD_API_URL || 'https://telegram-commander.onrender.com',
  
  // Local Obsidian vault
  vaultPath: process.env.VAULT_PATH || 'C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault',
  inboxDir: '_Miya/Telegram/inbox',
  outboxDir: '_Miya/Telegram/outbox',
  
  // Sync interval (seconds)
  pollInterval: parseInt(process.env.POLL_INTERVAL) || 3,
  
  // Auth token for cloud API (optional)
  apiToken: process.env.CLOUD_API_TOKEN || '',
};

// Track which messages we've already processed
const KNOWN_IDS_FILE = path.join(__dirname, 'data', 'known-msg-ids.json');
let knownMsgIds = new Set();

// Load known IDs from disk (survive restarts)
try {
  if (fs.existsSync(KNOWN_IDS_FILE)) {
    const arr = JSON.parse(fs.readFileSync(KNOWN_IDS_FILE, 'utf-8'));
    if (Array.isArray(arr)) knownMsgIds = new Set(arr);
    console.log(`[sync] Loaded ${knownMsgIds.size} known message IDs`);
  }
} catch (e) {
  console.log(`[sync] Could not load known IDs: ${e.message}`);
}

function saveKnownIds() {
  try {
    const dir = path.dirname(KNOWN_IDS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Keep only last 1000 IDs to prevent file bloat
    const arr = Array.from(knownMsgIds).slice(-1000);
    fs.writeFileSync(KNOWN_IDS_FILE, JSON.stringify(arr), 'utf-8');
  } catch (e) {
    console.log(`[sync] Could not save known IDs: ${e.message}`);
  }
}

// ================================================================
// Obsidian Vault FS
// ================================================================
function vaultPath(relative) {
  return path.join(CONFIG.vaultPath, relative);
}

function vaultWrite(relative, content) {
  const fp = vaultPath(relative);
  try {
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, content, 'utf-8');
    return true;
  } catch (e) { return false; }
}

function vaultRead(relative) {
  const fp = vaultPath(relative);
  try { return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : null; }
  catch (e) { return null; }
}

function vaultDelete(relative) {
  const fp = vaultPath(relative);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); return true; }
  catch (e) { return false; }
}

function vaultList(dir) {
  const fp = vaultPath(dir);
  try { return fs.existsSync(fp) ? fs.readdirSync(fp).filter(f => f.endsWith('.md')).sort() : []; }
  catch (e) { return []; }
}

function vaultAppend(relative, content) {
  const fp = vaultPath(relative);
  try {
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(fp, content, 'utf-8');
    return true;
  } catch (e) { return false; }
}

// ================================================================
// HTTP helpers
// ================================================================
function apiGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CONFIG.cloudApi);
    const client = url.protocol === 'https:' ? https : http;
    client.get(url.href, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', (err) => reject(err));
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CONFIG.cloudApi);
    const data = JSON.stringify(body);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      rejectUnauthorized: false,
    }, (res) => {
      let response = '';
      res.on('data', chunk => response += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(response)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

// ================================================================
// Sync Logic
// ================================================================

// 1. Pull messages from cloud → write to Obsidian inbox
async function pullMessages() {
  try {
    const result = await apiGet('/api/messages');
    if (!result || !Array.isArray(result.messages)) return;

    for (const msg of result.messages) {
      if (knownMsgIds.has(msg.msgId)) continue;
      knownMsgIds.add(msg.msgId);

      const ts = msg.ts || new Date().toISOString();
      const filename = `${ts.replace(/[:.]/g, '-')}-${msg.msgId}.md`;
      const content = `---\nfrom: ${msg.from || 'telegram'}\nmsg_id: ${msg.msgId}\nts: ${ts}\n---\n\n${msg.text}\n`;
      vaultWrite(`${CONFIG.inboxDir}/${filename}`, content);
      
      const today = ts.split('T')[0];
      vaultAppend(`_Miya/Daily/${today}.md`, `\n## Telegram — ${ts}\n> ${msg.text}\n`);
      
      console.log(`[sync] <- Inbox: ${msg.text.substring(0, 60)}`);
      saveKnownIds();
    }

    // Acknowledge processed messages
    if (result.messages.length > 0) {
      const msgIds = result.messages.map(m => m.msgId);
      await apiPost('/api/messages/ack', { msgIds });
    }
  } catch (e) {
    // Cloud not available — that's ok, will retry
  }
}

// 2. Push responses from Obsidian outbox → cloud bot
async function pushResponses() {
  try {
    const files = vaultList(CONFIG.outboxDir);
    if (files.length === 0) return;

    for (const f of files) {
      const content = vaultRead(`${CONFIG.outboxDir}/${f}`);
      if (!content) { vaultDelete(`${CONFIG.outboxDir}/${f}`); continue; }

      const msgIdMatch = content.match(/^target_msg_id:\s*(\d+)$/m);
      const replyTo = msgIdMatch ? parseInt(msgIdMatch[1]) : undefined;
      const isScreenshot = content.includes('__SCREENSHOT__');

      if (isScreenshot) {
        // Can't do screenshots via cloud API
        continue;
      }

      const cleanContent = content.replace(/^---[\s\S]*?---\n\n/, '').trim();
      if (cleanContent) {
        await apiPost('/api/send', { text: cleanContent, replyTo });
        console.log(`[sync] -> Sent: ${cleanContent.substring(0, 60)}`);
      }

      vaultDelete(`${CONFIG.outboxDir}/${f}`);
    }
  } catch (e) {
    // Cloud not available
  }
}

let CLOUD_AVAILABLE = false;

// ================================================================
// Sync Loop
// ================================================================
async function syncLoop() {
  if (!CLOUD_AVAILABLE) return;
  await pullMessages();
  await pushResponses();
}

async function checkCloud() {
  try {
    await apiGet('/health');
    if (!CLOUD_AVAILABLE) {
      console.log('[sync] ✅ Cloud bot connected');
      CLOUD_AVAILABLE = true;
    }
  } catch (e) {
    if (CLOUD_AVAILABLE) {
      console.log('[sync] ❌ Cloud bot lost, retrying...');
      CLOUD_AVAILABLE = false;
    }
  }
}

// ================================================================
// Start
// ================================================================
async function start() {
  console.log('');
  console.log('========================================');
  console.log('  Cloud Sync v1.0');
  console.log('  Cloud Bot ← → Obsidian Bridge');
  console.log(`  Cloud API: ${CONFIG.cloudApi}`);
  console.log('========================================');
  console.log('');

  console.log(`[sync] Starting... (poll every ${CONFIG.pollInterval}s)`);
  console.log('[sync] Waiting for cloud bot...');

  // Check cloud immediately
  await checkCloud();

  // Sync loop
  setInterval(async () => {
    await checkCloud();
    if (CLOUD_AVAILABLE) {
      await pullMessages();
      await pushResponses();
    }
  }, CONFIG.pollInterval * 1000);

  // Periodic known IDs cleanup (every 10 min)
  setInterval(() => saveKnownIds(), 600000);

  console.log('[sync] ✅ Sync active');
  console.log(`[sync]    Poll every ${CONFIG.pollInterval}s`);
  console.log(`[sync]    Cloud API: ${CONFIG.cloudApi}`);
  console.log(`[sync]    Vault: ${CONFIG.vaultPath}`);
}

start();
