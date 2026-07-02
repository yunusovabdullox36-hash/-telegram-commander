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
// FEATURE MODULES
// ================================================================
const remote = require('./features/remote');
const imagegen = require('./features/imagegen');
const aichat = require('./features/aichat');
const files = require('./features/files');
// voice is loaded on-demand (needs ffmpeg/form-data)

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
          await tgSend(CONFIG.ownerId, item.text, { reply_to_message_id: item.replyTo });
        } else if (item.type === 'screenshot') {
          await tgSend(CONFIG.ownerId, '❌ Screenshot not available in cloud mode');
        }
      } catch (e) {
        log(`Cloud send error: ${e.message}`);
        if (e.message.includes('429') || e.message.includes('retry')) {
          await new Promise(resolve => setTimeout(resolve, 5000));
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
let lastUpdateId = 0; // For fetch-based polling offset

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
      const botName = bot?.botInfo ? `@${bot.botInfo.username}` : 'init';
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

    // Force start Telegram polling (manual trigger)
    if (pathname === '/api/poll/start') {
      (async () => {
        try {
          const result = await tgApi('getMe', 20000);
          const me = result.result;
          log(`✅ Manual poll: @${me.username}`);
          bot.botInfo = { id: me.id, username: me.username };
          
          // Start outbox processing
          const outboxTimer = setInterval(() => processOutbox(bot), 2000);
          pollingIntervals.push(outboxTimer);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, bot: me.username }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      })();
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
        screenshotAvailable: remote.isScreenshotAvailable,
      }));
      return;
    }

    // ================================================================
    // FEATURE API ENDPOINTS (Cloud mode)
    // ================================================================
    
    // AI Chat
    if (pathname === '/api/ai' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { prompt } = JSON.parse(body);
          if (!prompt) { res.writeHead(400); res.end(JSON.stringify({ error: 'prompt required' })); return; }
          const result = await aichat.aiChat(prompt);
          res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }

    // Image Generation
    if (pathname === '/api/img' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { prompt, width, height } = JSON.parse(body);
          if (!prompt) { res.writeHead(400); res.end(JSON.stringify({ error: 'prompt required' })); return; }
          const result = await imagegen.generateImage(prompt, width || 1024, height || 1024);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            source: result.source,
            buffer: result.buffer.toString('base64'),
          }));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }

    // PC Status (read-only, safe for cloud)
    if (pathname === '/api/pcstatus') {
      (async () => {
        if (!IS_LOCAL) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ mode: 'cloud', message: 'PC not available in cloud mode' }));
          return;
        }
        try {
          const status = await remote.getPCStatus();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
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
          `🤖 *Telegram Commander v4.1*\n\n` +
          `• Mode: ${MODE}\n` +
          `• Messages: ${messageQueue.length} in / ${outboxQueue.length} out\n` +
          `• Uptime: ${Math.floor(process.uptime() / 60)} min\n` +
          `• CWD: \`${files.getCwd()}\`\n` +
          `• Remote: ${IS_LOCAL ? '✅' : '☁️ API-only'}\n` +
          `• Screenshot: ${remote.isScreenshotAvailable ? '✅' : '❌'}\n` +
          `• AI: ${process.env.OPENAI_API_KEY || process.env.AI_API_KEY ? '✅' : '❌ API key'}`,
          { parse_mode: 'Markdown' }
        );
        return;
      case '/help':
        await ctx.reply(
          `📋 *Telegram Commander v4.1*\n\n` +
          `*PC Remote:*\n` +
          `/cmd <command> — Run shell command\n` +
          `/ps [name] — List processes\n` +
          `/kill <name|pid> — Kill process\n` +
          `/shutdown [s] — Shutdown PC\n` +
          `/reboot [s] — Reboot PC\n` +
          `/lock — Lock workstation\n` +
          `/sleep — Sleep mode\n` +
          `/pcstatus — CPU, RAM, uptime\n` +
          `/clipboard — Read clipboard\n` +
          `/screenshot — 📸 Take screenshot\n\n` +
          `*Files:*\n` +
          `/dir [path] — List directory\n` +
          `/cd <path> — Change directory\n` +
          `/cat <file> — Read file\n` +
          `/download <file> — Download file\n\n` +
          `*AI:*\n` +
          `/ai <prompt> — Ask AI (OpenAI)\n` +
          `/img <prompt> — Generate image\n` +
          `/opencode <prompt> — OpenCode CLI\n` +
          `/gemini <prompt> — Gemini CLI\n\n` +
          `*System:*\n` +
          `/status — Bot status\n` +
          `/queue — Pending messages\n` +
          `/help — This help`,
          { parse_mode: 'Markdown' }
        );
        return;
      case '/queue':
        await ctx.reply(`📬 Pending: ${messageQueue.length} messages, ${outboxQueue.length} outgoing`);
        return;
      case '/screenshot':
        if (IS_LOCAL) {
          try {
            const img = await remote.takeScreenshot();
            await ctx.replyWithPhoto({ source: img }, { caption: `📸 ${new Date().toLocaleString()}` });
          } catch (e) {
            await ctx.reply(`❌ Screenshot failed: ${e.message}`);
          }
        } else {
          await ctx.reply('❌ Screenshot only available in local mode');
        }
        return;
      // ================================================================
      // PC REMOTE CONTROL
      // ================================================================
      case '/cmd': {
        const cmd = text.substring(5).trim();
        if (!cmd) { await ctx.reply('Usage: /cmd <command>\nExample: /cmd dir'); return; }
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        const result = await remote.runCommand(cmd);
        const output = result.length > 4000 ? result.substring(0, 3900) + '\n... (truncated)' : result;
        await ctx.reply(`💻 \`${cmd}\`\n\`\`\`\n${output}\n\`\`\``, { parse_mode: 'Markdown' });
        return;
      }
      case '/ps': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        const filter = text.substring(4).trim() || null;
        const result = await remote.listProcesses(filter);
        await ctx.reply(`📊 Processes:\n\`\`\`\n${result.substring(0, 3500)}\n\`\`\``, { parse_mode: 'Markdown' });
        return;
      }
      case '/kill': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        const target = text.substring(6).trim();
        if (!target) { await ctx.reply('Usage: /kill <process_name|PID>'); return; }
        const result = await remote.killProcess(target);
        await ctx.reply(`🔪 ${result.substring(0, 500)}`);
        return;
      }
      case '/shutdown': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        const delay = parseInt(text.substring(10).trim()) || 30;
        const result = await remote.shutdownPC(delay);
        await ctx.reply(`🔌 Shutdown in ${delay}s\n${result}`);
        return;
      }
      case '/reboot': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        const delay = parseInt(text.substring(8).trim()) || 30;
        const result = await remote.rebootPC(delay);
        await ctx.reply(`🔄 Reboot in ${delay}s\n${result}`);
        return;
      }
      case '/lock': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        await remote.lockWorkstation();
        await ctx.reply('🔒 PC locked');
        return;
      }
      case '/sleep': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        await remote.sleepMode();
        await ctx.reply('💤 Good night!');
        return;
      }
      case '/pcstatus': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        const status = await remote.getPCStatus();
        await ctx.reply(
          `🖥️ *PC Status*\n\n` +
          `• Host: \`${status.hostname}\`\n` +
          `• OS: ${status.platform}\n` +
          `• Uptime: ${status.uptime}\n` +
          `• CPU: ${status.cpuLoad} (${status.cpu})\n` +
          `• RAM: ${status.memory}\n` +
          `• Screenshot: ${status.screenshot ? '✅' : '❌'}`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      case '/clipboard': {
        if (!IS_LOCAL) { await ctx.reply('❌ PC control only in local mode'); return; }
        const result = await remote.readClipboard();
        const output = result.length > 1000 ? result.substring(0, 1000) + '\n... (truncated)' : result;
        await ctx.reply(`📋 Clipboard:\n\`\`\`\n${output}\n\`\`\``, { parse_mode: 'Markdown' });
        return;
      }
      // ================================================================
      // FILE OPERATIONS
      // ================================================================
      case '/dir': {
        if (!IS_LOCAL) { await ctx.reply('❌ File ops only in local mode'); return; }
        const dirArg = text.substring(5).trim() || '.';
        try {
          const listing = files.listDirectory(dirArg);
          await ctx.reply(listing.substring(0, 4000), { parse_mode: 'Markdown' });
        } catch (e) { await ctx.reply(`❌ ${e.message}`); }
        return;
      }
      case '/cd': {
        if (!IS_LOCAL) { await ctx.reply('❌ File ops only in local mode'); return; }
        const target = text.substring(4).trim();
        if (!target) { await ctx.reply(`📂 ${files.getCwd()}`); return; }
        if (files.setCwd(target)) {
          await ctx.reply(`📂 ${files.getCwd()}`);
        } else {
          await ctx.reply(`❌ Directory not found: ${target}`);
        }
        return;
      }
      case '/cat': {
        if (!IS_LOCAL) { await ctx.reply('❌ File ops only in local mode'); return; }
        const filePath = text.substring(5).trim();
        if (!filePath) { await ctx.reply('Usage: /cat <filepath>'); return; }
        try {
          const content = files.readFileContent(filePath);
          await ctx.reply(content.substring(0, 4000), { parse_mode: 'Markdown' });
        } catch (e) { await ctx.reply(`❌ ${e.message}`); }
        return;
      }
      case '/download': {
        if (!IS_LOCAL) { await ctx.reply('❌ File ops only in local mode'); return; }
        const filePath = text.substring(10).trim();
        if (!filePath) { await ctx.reply('Usage: /download <filepath>'); return; }
        try {
          const absPath = files.getFilePath(filePath);
          if (!require('fs').existsSync(absPath)) { await ctx.reply('❌ File not found'); return; }
          await ctx.replyWithDocument({ source: absPath, filename: path.basename(absPath) });
        } catch (e) { await ctx.reply(`❌ ${e.message}`); }
        return;
      }
      // ================================================================
      // AI & IMAGE GENERATION
      // ================================================================
      case '/ai':
      case '/ask': {
        const prompt = text.substring(text.startsWith('/ai') ? 4 : 5).trim();
        if (!prompt) { await ctx.reply('Usage: /ai <question>'); return; }
        await ctx.reply('🤔 Thinking...');
        const result = await aichat.aiChat(prompt);
        if (result.error) { await ctx.reply(`❌ ${result.error}`); return; }
        const reply = result.text.length > 4000 ? result.text.substring(0, 3900) + '\n...' : result.text;
        await ctx.reply(reply, { parse_mode: 'Markdown' });
        return;
      }
      case '/img':
      case '/imagine': {
        const prompt = text.substring(text.startsWith('/img') ? 5 : 9).trim();
        if (!prompt) { await ctx.reply('Usage: /img <prompt> [width] [height]\nExample: /img futuristic city 1024 768'); return; }
        const parts = prompt.split(' ');
        let w = 1024, h = 1024, model = 'flux';
        const imgPrompt = [];
        for (const p of parts) {
          if (/^\d+$/.test(p) && !w) { w = parseInt(p); }
          else if (/^\d+$/.test(p) && w) { h = parseInt(p); }
          else { imgPrompt.push(p); }
        }
        await ctx.reply('🎨 Generating image...');
        try {
          const { buffer, source } = await imagegen.generateImage(imgPrompt.join(' '), w, h, model);
          await ctx.replyWithPhoto({ source: buffer }, { caption: `🎨 ${imgPrompt.join(' ')}\n🖼️ ${w}x${h} | Source: ${source}` });
        } catch (e) {
          await ctx.reply(`❌ ${e.message}`);
        }
        return;
      }
      case '/opencode': {
        if (!IS_LOCAL) { await ctx.reply('❌ CLI mode only in local mode'); return; }
        const prompt = text.substring(10).trim();
        if (!prompt) { await ctx.reply('Usage: /opencode <prompt>'); return; }
        await ctx.reply('🤖 Running OpenCode...');
        const result = await aichat.runCLI('opencode', prompt, { timeout: 120000 });
        if (result.error) { await ctx.reply(`❌ ${result.error}`); return; }
        await ctx.reply(`\`\`\`\n${result.text.substring(0, 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
        return;
      }
      case '/gemini': {
        if (!IS_LOCAL) { await ctx.reply('❌ CLI mode only in local mode'); return; }
        const prompt = text.substring(8).trim();
        if (!prompt) { await ctx.reply('Usage: /gemini <prompt>'); return; }
        await ctx.reply('🤖 Running Gemini CLI...');
        const result = await aichat.runCLI('gemini', prompt, { timeout: 120000 });
        if (result.error) { await ctx.reply(`❌ ${result.error}`); return; }
        await ctx.reply(`\`\`\`\n${result.text.substring(0, 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
        return;
      }
    }
  }

  // Save non-command messages
  saveIncomingMessage(text, msgId, ts);
});

// ================================================================
// START — Minimal: HTTP server first, webhook + polling async
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
    // Start HTTP server FIRST — synchronous, no await
    startCloudAPI(null, false);
    
    // Set webhook (async, one-shot, no retry loop)
    try {
      const result = await tgApi('getMe', 15000);
      const me = result.result;
      bot.botInfo = { id: me.id, username: me.username };
      log(`✅ Bot @${me.username} authenticated`);
      
      try {
        const webhookUrl = `https://${CONFIG.webhookDomain}/telegraf`;
        await tgApi(`setWebhook?url=${encodeURIComponent(webhookUrl)}`, 10000);
        log(`✅ Webhook set: ${webhookUrl}`);
      } catch (whErr) {
        log(`⚠️ Webhook failed: ${whErr.message}`);
      }
      
      // Start fetch-based polling for incoming messages
      startFetchPolling(bot).catch(e => log(`Poll loop crashed: ${e.message}`));
      
      // Outbox polling (every 2s) — fetch-based
      const outboxTimer = setInterval(() => processOutbox(bot), 2000);
      pollingIntervals.push(outboxTimer);
      
      log('✅ Telegram polling active — receiving messages');
    } catch (e) {
      log(`⚠️ Telegram init failed: ${e.message}`);
      log('   API-only mode — bot cannot send/receive Telegram messages');
      log('   /api/send and /api/messages routes still work');
    }
  } else {
    // Local mode
    vaultWrite(`${CONFIG.inboxDir}/.gitkeep`, '');
    vaultWrite(`${CONFIG.outboxDir}/.gitkeep`, '');
    
    try {
      const me = await bot.telegram.getMe();
      bot.botInfo = me;
      log(`✅ Bot @${me.username} connected`);
      bot.startPolling();
      
      const outboxTimer = setInterval(() => processOutbox(bot), 2000);
      pollingIntervals.push(outboxTimer);
      
      log('✅ Relay active');
    } catch (e) {
      log(`❌ Telegram connection failed: ${e.message}`);
      process.exit(1);
    }
  }

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
  return data;
}

// Fetch-based Telegram send (avoids Telegraf's http client in cloud mode)
async function tgSend(chatId, text, opts = {}) {
  const params = new URLSearchParams({ chat_id: chatId, text });
  if (opts.reply_to_message_id) params.set('reply_to_message_id', opts.reply_to_message_id);
  if (opts.parse_mode) params.set('parse_mode', opts.parse_mode);
  await tgApi(`sendMessage?${params.toString()}`, 10000);
}

async function tgSendPhoto(chatId, caption) {
  await tgSend(chatId, `📸 ${caption}`);
}

// Simple fetch-based polling loop (no Telegraf dependency)
async function startFetchPolling(bot) {
  log('📡 Starting fetch-based polling...');
  let pollCount = 0;
  
  while (true) {
    try {
      const timeout = 30000; // 30s long poll
      const params = `getUpdates?timeout=${timeout}&offset=${lastUpdateId + 1}&limit=10&allowed_updates=["message"]`;
      const result = await tgApi(params, timeout + 5000);
      
      if (result.ok && Array.isArray(result.result)) {
        for (const update of result.result) {
          if (update.update_id > lastUpdateId) lastUpdateId = update.update_id;
          
          if (update.message && update.message.text) {
            const ctx = {
              message: update.message,
              reply: async (text, extra) => {
                const payload = `sendMessage?chat_id=${update.message.chat.id}&text=${encodeURIComponent(text)}&reply_to_message_id=${update.message.message_id}`;
                return tgApi(payload, 5000).catch(e => log(`Reply error: ${e.message}`));
              }
            };
            // Process message
            const text = update.message.text;
            log(`<- (poll) ${text.substring(0, 80)}`);
            
            // Handle commands
            if (text.startsWith('/')) {
              const cmd = text.split(' ')[0].toLowerCase();
              switch (cmd) {
                case '/start': await ctx.reply('✅ Telegram Commander Cloud — 24/7 active'); break;
                case '/status': await ctx.reply(`🤖 Bot status:\n• Mode: cloud\n• Pending messages: ${messageQueue.length}\n• Uptime: ${Math.floor(process.uptime() / 60)} min`); break;
                case '/help': await ctx.reply(`📋 Commands:\n/status — Bot status\n/help — This help`); break;
                case '/queue': await ctx.reply(`📬 Pending: ${messageQueue.length} messages, ${outboxQueue.length} outgoing`); break;
                default: await ctx.reply(`Unknown command: ${cmd}`); break;
              }
            }
            
            // Save message
            saveIncomingMessage(text, update.message.message_id, new Date().toISOString());
          }
        }
      }
      
      pollCount++;
      if (pollCount % 10 === 0) log(`Polling: ${pollCount} cycles, lastUpdateId: ${lastUpdateId}`);
    } catch (e) {
      log(`Poll error: ${e.message} — retrying in 10s`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// Async Telegram connection (fetch-based, NOT Telegraf's http client)
async function connectTelegramAsync(bot) {
  try {
    const result = await tgApi('getMe', 15000);
    const me = result.result;
    bot.botInfo = { id: me.id, username: me.username };
    
    log(`✅ Telegram connected as @${me.username}`);
    
    if (IS_CLOUD && CONFIG.webhookDomain) {
      try {
        const webhookUrl = `https://${CONFIG.webhookDomain}/telegraf`;
        await tgApi(`setWebhook?url=${encodeURIComponent(webhookUrl)}`, 10000);
        log(`✅ Webhook set: ${webhookUrl}`);
      } catch (e) {
        log(`⚠️ Webhook failed: ${e.message}`);
      }
    }
    
    // Start fetch-based polling (runs forever, doesn't block HTTP server)
    startFetchPolling(bot).catch(e => log(`Poll loop crashed: ${e.message}`));
    
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
