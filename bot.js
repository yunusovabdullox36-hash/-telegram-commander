// ================================================================
// Telegram Commander v4.1 — DUAL MODE (Local + Cloud)
// ================================================================
// Rey <-> Telegram <-> Bot <-> AI <-> Bot <-> Telegram <-> Rey
// 
// MODE=local (default):  Bot <-> Obsidian vault (Windows)
// MODE=cloud:            Bot <-> JSON store + REST API (Render)
// 
// Features:
//   - Dual mode: local (Obsidian FS) / cloud (JSON queue)
//   - Webhook mode (cloud, when WEBHOOK_DOMAIN set)
//   - Polling mode (local, or cloud fallback)
//   - Optional screenshot (try/catch, graceful fallback)
//   - Outbox sharding (20 msg/batch)
//   - Rate limiting (20 msg/s, Retry-After support)
//   - Graceful shutdown (all timers cleared)
//   - Health check + Stats API
// ================================================================

const { Telegraf } = require('telegraf');
const https = require('https');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ================================================================
// Mode Detection
// ================================================================
const MODE = (process.env.CLIENT_MODE || 'local').toLowerCase();
const IS_CLOUD = MODE === 'cloud';
const IS_LOCAL = !IS_CLOUD;

// ================================================================
// HTTPS AGENT (self-signed cert for local Obsidian)
// ================================================================
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ================================================================
// Config
// ================================================================
const CONFIG = {
  token: process.env.BOT_TOKEN || '8859542275:AAEBetf9Zpro5oqHK7JQix_ZQOmtB-qY80Y',
  ownerId: parseInt(process.env.OWNER_ID) || 7254093696,
  vaultPath: process.env.VAULT_PATH || 'C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault',
  inboxDir: '_Miya/Telegram/inbox',
  outboxDir: '_Miya/Telegram/outbox',
  webhookDomain: process.env.WEBHOOK_DOMAIN || '',
  webhookPort: parseInt(process.env.WEBHOOK_PORT) || 443,
  serverPort: parseInt(process.env.PORT) || 3000,
  // Cloud storage
  dataDir: path.join(__dirname, 'data'),
  // Rate limiting
  maxRatePerSec: 20,
  // Outbox sharding
  outboxBatchSize: 20,
};

// ================================================================
// RATE LIMITER
// ================================================================
class RateLimiter {
  constructor(maxPerSec) {
    this.maxPerSec = maxPerSec;
    this.tokens = maxPerSec;
    this.lastRefill = Date.now();
    this.queue = [];
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxPerSec, this.tokens + elapsed * this.maxPerSec);
    this.lastRefill = now;
  }

  async acquire() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    // Wait for next token
    const waitMs = Math.ceil((1 / this.maxPerSec) * 1000);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return this.acquire();
  }
}

const rateLimiter = new RateLimiter(CONFIG.maxRatePerSec);

// ================================================================
// STORAGE — Local mode: Obsidian vault | Cloud mode: JSON files
// ================================================================

// --- LOCAL MODE: Obsidian Vault FS ---
const vaultPath = (relative) => path.join(CONFIG.vaultPath, relative);

function vaultRead(relative) {
  const fp = vaultPath(relative);
  try { return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : null; }
  catch (e) { return null; }
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

// --- CLOUD MODE: JSON Queue ---
let messageQueue = [];       // Incoming messages (pending for AI to process)
let outboxQueue = [];        // Outgoing responses (to send via Telegram)
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const OUTBOX_FILE = path.join(__dirname, 'data', 'outbox.json');

function cloudInit() {
  if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  // Load existing queues
  try {
    if (fs.existsSync(MESSAGES_FILE)) messageQueue = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
  } catch (e) { messageQueue = []; }
  try {
    if (fs.existsSync(OUTBOX_FILE)) outboxQueue = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf-8'));
  } catch (e) { outboxQueue = []; }
}

function cloudSaveMessages() {
  try {
    const dir = path.dirname(MESSAGES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messageQueue, null, 2), 'utf-8');
  } catch (e) { log(`Save messages error: ${e.message}`); }
}

function cloudSaveOutbox() {
  try {
    const dir = path.dirname(OUTBOX_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUTBOX_FILE, JSON.stringify(outboxQueue, null, 2), 'utf-8');
  } catch (e) { log(`Save outbox error: ${e.message}`); }
}

// ================================================================
// SCREENSHOT — Optional (try/catch, graceful fallback)
// ================================================================
let screenshotModule = null;
try {
  screenshotModule = require('screenshot-desktop');
  log('📸 Screenshot module loaded');
} catch (e) {
  log('📸 Screenshot module not available (optional)');
}

function isScreenshotAvailable() {
  return screenshotModule !== null && typeof screenshotModule === 'function';
}

// ================================================================
// MESSAGE HANDLING — Unified API
// ================================================================

function saveIncomingMessage(text, msgId, ts) {
  if (IS_LOCAL) {
    // Save to Obsidian inbox
    const filename = `${ts.replace(/[:.]/g, '-')}-${msgId}.md`;
    const content = `---\nfrom: ${CONFIG.ownerId}\nmsg_id: ${msgId}\nts: ${ts}\n---\n\n${text}\n`;
    vaultWrite(`${CONFIG.inboxDir}/${filename}`, content);
    // Append to daily log
    const today = ts.split('T')[0];
    vaultAppend(`_Miya/Daily/${today}.md`, `\n## Telegram — ${ts}\n> ${text}\n`);
  } else {
    // Save to cloud queue
    messageQueue.push({ text, msgId, ts, from: CONFIG.ownerId });
    cloudSaveMessages();
  }
}

async function processOutbox(bot) {
  if (IS_LOCAL) {
    // Read from Obsidian outbox
    const files = vaultList(CONFIG.outboxDir);
    if (files.length === 0) return;

    // Shard: process up to batchSize files at a time
    const batch = files.slice(0, CONFIG.outboxBatchSize);
    for (const f of batch) {
      const content = vaultRead(`${CONFIG.outboxDir}/${f}`);
      if (!content) { vaultDelete(`${CONFIG.outboxDir}/${f}`); continue; }

      const msgIdMatch = content.match(/^target_msg_id:\s*(\d+)$/m);
      const targetMsgId = msgIdMatch ? parseInt(msgIdMatch[1]) : undefined;
      const isScreenshot = content.includes('__SCREENSHOT__');

      await rateLimiter.acquire();
      try {
        if (isScreenshot) {
          await handleScreenshot(bot);
        } else {
          const cleanContent = content.replace(/^---[\s\S]*?---\n\n/, '').trim();
          if (cleanContent) {
            await bot.telegram.sendMessage(CONFIG.ownerId, cleanContent, {
              reply_to_message_id: targetMsgId
            });
          }
        }
      } catch (e) {
        log(`Send error: ${e.message}`);
        // If rate limited, wait and retry
        if (e.response && e.response.statusCode === 429) {
          const retryAfter = e.response.parameters?.retry_after || 5;
          log(`Rate limited, waiting ${retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        }
      }
      vaultDelete(`${CONFIG.outboxDir}/${f}`);
    }
  } else {
    // Read from cloud outbox queue
    const pending = outboxQueue.splice(0, CONFIG.outboxBatchSize);
    cloudSaveOutbox();

    for (const item of pending) {
      await rateLimiter.acquire();
      try {
        if (item.type === 'text') {
          await bot.telegram.sendMessage(CONFIG.ownerId, item.text, {
            reply_to_message_id: item.replyTo
          });
        } else if (item.type === 'screenshot') {
          if (isScreenshotAvailable() && IS_LOCAL) {
            await handleScreenshot(bot);
          } else {
            await bot.telegram.sendMessage(CONFIG.ownerId, '❌ Screenshot not available in cloud mode');
          }
        }
      } catch (e) {
        log(`Cloud send error: ${e.message}`);
        if (e.response && e.response.statusCode === 429) {
          const retryAfter = e.response.parameters?.retry_after || 5;
          log(`Rate limited, waiting ${retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          // Re-queue failed items
          outboxQueue.unshift(item);
          cloudSaveOutbox();
        }
      }
    }
  }
}

async function handleScreenshot(bot) {
  if (!isScreenshotAvailable()) {
    await bot.telegram.sendMessage(CONFIG.ownerId, '❌ Screenshot module not installed.\nRun: npm install screenshot-desktop');
    return;
  }
  log('Sending screenshot...');
  try {
    const img = await screenshotModule({ format: 'png' });
    await bot.telegram.sendPhoto(CONFIG.ownerId, { source: img });
    log('Screenshot sent OK');
  } catch (se) {
    await bot.telegram.sendMessage(CONFIG.ownerId, `Screenshot error: ${se.message}`);
  }
}

// ================================================================
// LOG
// ================================================================
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (IS_LOCAL) {
    try { vaultAppend('_Miya/Telegram/bot.log', line + '\n'); } catch (e) {}
  }
}

// ================================================================
// REST API (Cloud mode only) + Webhook Server
// ================================================================
let cloudServer = null;
let pollingIntervals = [];

function startCloudAPI(bot, useWebhook) {
  const app = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${CONFIG.serverPort}`);
    const pathname = url.pathname;

    // Health check (required by Render) — always respond even before Telegram
    if (pathname === '/' || pathname === '/health') {
      const botName = (bot && bot.botInfo) ? `@${bot.botInfo.username}` : 'connecting...';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        mode: 'cloud',
        bot: botName,
        uptime: process.uptime(),
        queuedMessages: messageQueue.length,
        queuedOutbox: outboxQueue.length,
        webhook: useWebhook ? 'active' : 'polling',
        rateLimit: `${CONFIG.maxRatePerSec}/s`,
      }));
      return;
    }

    // Get pending messages (for OpenCode to pick up)
    if (pathname === '/api/messages' && req.method === 'GET') {
      const msgs = [...messageQueue];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: msgs }));
      return;
    }

    // Acknowledge & remove messages (after OpenCode processed them)
    if (pathname === '/api/messages/ack' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { msgIds } = JSON.parse(body);
          if (Array.isArray(msgIds)) {
            messageQueue = messageQueue.filter(m => !msgIds.includes(m.msgId));
            cloudSaveMessages();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, remaining: messageQueue.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Send a message (OpenCode writes response here)
    if (pathname === '/api/send' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { text, replyTo } = JSON.parse(body);
          outboxQueue.push({ type: 'text', text, replyTo: replyTo || undefined });
          cloudSaveOutbox();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, queued: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Debug — test Telegram API connectivity
    if (pathname === '/api/debug') {
      (async () => {
        try {
          const resp = await withTimeout(fetch('https://api.telegram.org/bot' + CONFIG.token + '/getMe'), 10000, 'test-telegram');
          const data = await resp.json();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ telegram: 'reachable', ok: data.ok, username: data.result?.username }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ telegram: 'unreachable', error: e.message }));
        }
      })();
      return;
    }

    // Stats
    if (pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        uptime: process.uptime(),
        messagesReceived: messageQueue.length,
        messagesQueued: outboxQueue.length,
        mode: 'cloud',
        webhook: useWebhook ? 'active' : 'polling',
        screenshotAvailable: isScreenshotAvailable(),
      }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not found');
  });

  cloudServer = app.listen(CONFIG.serverPort, '0.0.0.0', () => {
    log(`✅ Cloud API running on port ${CONFIG.serverPort}`);
  });
}

// ================================================================
// TELEGRAM BOT
// ================================================================
const bot = new Telegraf(CONFIG.token);

// Only owner
bot.use((ctx, next) => {
  if (ctx.from && ctx.from.id === CONFIG.ownerId) return next();
  log(`Blocked: ${ctx.from?.id || 'unknown'}`);
});

// Message handler
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const msgId = ctx.message.message_id;
  const ts = new Date().toISOString();

  log(`<- ${text.substring(0, 80)}`);

  // Check for commands in cloud mode
  if (IS_CLOUD && text.startsWith('/')) {
    const cmd = text.split(' ')[0].toLowerCase();
    switch (cmd) {
      case '/start':
        await ctx.reply('✅ Telegram Commander Cloud — 24/7 active');
        return;
      case '/status':
        await ctx.reply(
          `🤖 Bot status:\n` +
          `• Mode: cloud\n` +
          `• Pending messages: ${messageQueue.length}\n` +
          `• Uptime: ${Math.floor(process.uptime() / 60)} min\n` +
          `• Screenshot: ${isScreenshotAvailable() ? '✅' : '❌'}`
        );
        return;
      case '/help':
        await ctx.reply(
          `📋 Commands:\n/status — Bot status\n/help — This help\n/queue — Pending messages count\n/screenshot — 📸 Take screenshot (local mode only)`
        );
        return;
      case '/queue':
        await ctx.reply(`📬 Pending: ${messageQueue.length} messages, ${outboxQueue.length} outgoing`);
        return;
      case '/screenshot':
        if (IS_LOCAL || isScreenshotAvailable()) {
          await handleScreenshot(bot);
        } else {
          await ctx.reply('❌ Screenshot only available in local mode');
        }
        return;
    }
  }

  // Save message
  saveIncomingMessage(text, msgId, ts);
});

// ================================================================
// START — Lazy connection: HTTP server first, Telegram async later
// ================================================================
async function start() {
  console.log('');
  console.log('========================================');
  console.log(`  Telegram Commander v4.1 — MODE: ${MODE.toUpperCase()}`);
  console.log('  Rey <-> Telegram <-> AI <-> Telegram <-> Rey');
  console.log('========================================');
  console.log('');

  log(`Starting in ${MODE.toUpperCase()} mode...`);

  if (IS_CLOUD) {
    cloudInit();
    // Start HTTP server FIRST so Render health check passes immediately
    startCloudAPI(null, false);
  } else {
    // Ensure Obsidian directories
    vaultWrite(`${CONFIG.inboxDir}/.gitkeep`, '');
    vaultWrite(`${CONFIG.outboxDir}/.gitkeep`, '');
  }

  // Connect to Telegram asynchronously with timeout
  connectTelegramAsync(bot).then(connected => {
    if (connected) {
      log('✅ Telegram connected');
      
      // Outbox polling (every 2 seconds) — only after Telegram is ready
      const outboxTimer = setInterval(() => processOutbox(bot), 2000);
      pollingIntervals.push(outboxTimer);
      
      // Health ping (cloud mode only)
      if (IS_CLOUD) {
        const healthTimer = setInterval(() => {
          log(`Heartbeat: ${messageQueue.length} in, ${outboxQueue.length} out`);
        }, 300000);
        pollingIntervals.push(healthTimer);
      }
      
      log('✅ Relay active');
    } else {
      log('⚠️ Telegram not available — running in API-only mode');
      log('   Bot will not send/receive messages until Telegram reconnects');
      // Keep retrying every 30 seconds
      const retryTimer = setInterval(async () => {
        try {
          const ok = await connectTelegramAsync(bot);
          if (ok) {
            clearInterval(retryTimer);
          log('✅ Telegram reconnected');
          
          // Start outbox processing
          const outboxTimer = setInterval(() => processOutbox(bot), 2000);
          pollingIntervals.push(outboxTimer);
          
          if (IS_CLOUD) {
            const healthTimer = setInterval(() => {
              log(`Heartbeat: ${messageQueue.length} in, ${outboxQueue.length} out`);
            }, 300000);
            pollingIntervals.push(healthTimer);
          }
          
          log('✅ Relay active');
        }
      } catch (e) {
        log(`Retry error: ${e.message}`);
      }
      }, 30000);
      pollingIntervals.push(retryTimer);
    }
  });

  log('✅ HTTP server running — Render health check ready');
}

// Helper: timeout wrapper for any promise (Promise.race approach)
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

// Fetch-based Telegram API call (bypasses Telegraf's http issues on Render)
async function tgApi(method, timeoutMs = 15000) {
  const url = `https://api.telegram.org/bot${CONFIG.token}/${method}`;
  const resp = await withTimeout(fetch(url), timeoutMs, `tg.${method}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description}`);
  return data.result;
}

// Async Telegram connection (fetch-based, NOT Telegraf's http client)
async function connectTelegramAsync(bot) {
  try {
    const me = await tgApi('getMe', 15000);
    bot.botInfo = { id: me.id, username: me.username };
    
    if (IS_CLOUD && CONFIG.webhookDomain) {
      // Try to set webhook (best effort)
      try {
        const webhookUrl = `https://${CONFIG.webhookDomain}/telegraf`;
        await tgApi(`setWebhook?url=${encodeURIComponent(webhookUrl)}`, 10000);
        log(`✅ Webhook set: ${webhookUrl}`);
        bot.webhookCallback = null; // We handle updates via raw HTTP route
      } catch (e) {
        log(`⚠️ Webhook failed: ${e.message}`);
      }
    }
    
    // Start polling with Telegraf (try/catch — if it hangs, we still have the API)
    try {
      bot.startPolling();
      log(`✅ Bot @${me.username} is live (polling on :${CONFIG.serverPort})`);
    } catch (e) {
      log(`⚠️ Polling start failed: ${e.message} — webhook mode only`);
    }
    return true;
  } catch (e) {
    log(`⚠️ Telegram connection failed: ${e.message}`);
    return false;
  }
}

// ================================================================
// SHUTDOWN — Graceful: clear all timers, stop servers
// ================================================================
function shutdown(signal) {
  log(`Received ${signal}, shutting down gracefully...`);
  
  // Clear all intervals
  pollingIntervals.forEach(t => clearInterval(t));
  pollingIntervals = [];
  
  // Stop bot
  bot.stop(signal);
  
  // Close API server
  if (cloudServer) {
    cloudServer.close();
    cloudServer = null;
  }
  
  log('Shutdown complete');
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => { log(`Uncaught: ${e.message}`); });
process.on('unhandledRejection', (e) => { log(`Unhandled: ${e.message}`); });

start();
