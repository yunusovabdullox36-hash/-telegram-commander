// ================================================================
// Telegram Commander v4.0 — DUAL MODE (Local + Cloud)
// ================================================================
// Rey <-> Telegram <-> Bot <-> AI <-> Bot <-> Telegram <-> Rey
// 
// MODE=local (default):  Bot <-> Obsidian vault (Windows)
// MODE=cloud:            Bot <-> JSON store + REST API (Render)
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
};

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
    for (const f of files) {
      const content = vaultRead(`${CONFIG.outboxDir}/${f}`);
      if (!content) { vaultDelete(`${CONFIG.outboxDir}/${f}`); continue; }

      const msgIdMatch = content.match(/^target_msg_id:\s*(\d+)$/m);
      const targetMsgId = msgIdMatch ? parseInt(msgIdMatch[1]) : undefined;
      const isScreenshot = content.includes('__SCREENSHOT__');

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
      }
      vaultDelete(`${CONFIG.outboxDir}/${f}`);
    }
  } else {
    // Read from cloud outbox queue
    const pending = [...outboxQueue];
    outboxQueue = [];
    cloudSaveOutbox();

    for (const item of pending) {
      try {
        if (item.type === 'text') {
          await bot.telegram.sendMessage(CONFIG.ownerId, item.text, {
            reply_to_message_id: item.replyTo
          });
        } else if (item.type === 'screenshot') {
          await bot.telegram.sendMessage(CONFIG.ownerId, '❌ Screenshot not available in cloud mode');
        }
      } catch (e) {
        log(`Cloud send error: ${e.message}`);
      }
    }
  }
}

async function handleScreenshot(bot) {
  log('Sending screenshot...');
  try {
    const screenshot = require('screenshot-desktop');
    const img = await screenshot({ format: 'png' });
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
    vaultAppend('_Miya/Telegram/bot.log', line + '\n');
  }
}

// ================================================================
// REST API (Cloud mode only)
// ================================================================
let cloudServer = null;

function startCloudAPI(bot) {
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

    // Health check (required by Render)
    if (pathname === '/' || pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        mode: 'cloud',
        bot: bot.botInfo ? `@${bot.botInfo.username}` : 'connecting...',
        uptime: process.uptime(),
        queuedMessages: messageQueue.length,
        queuedOutbox: outboxQueue.length
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

    // Stats
    if (pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        uptime: process.uptime(),
        messagesReceived: messageQueue.length,
        messagesQueued: outboxQueue.length,
        mode: 'cloud'
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
          `• Uptime: ${Math.floor(process.uptime() / 60)} min`
        );
        return;
      case '/help':
        await ctx.reply(
          `📋 Commands:\n/status — Bot status\n/help — This help\n/queue — Pending messages count`
        );
        return;
      case '/queue':
        await ctx.reply(`📬 Pending: ${messageQueue.length} messages, ${outboxQueue.length} outgoing`);
        return;
    }
  }

  // Save message
  saveIncomingMessage(text, msgId, ts);
});

// ================================================================
// START
// ================================================================
async function start() {
  console.log('');
  console.log('========================================');
  console.log(`  Telegram Commander v4.0 — MODE: ${MODE.toUpperCase()}`);
  console.log('  Rey <-> Telegram <-> AI <-> Telegram <-> Rey');
  console.log('========================================');
  console.log('');

  log(`Starting in ${MODE.toUpperCase()} mode...`);

  if (IS_CLOUD) {
    cloudInit();
  } else {
    // Ensure Obsidian directories
    vaultWrite(`${CONFIG.inboxDir}/.gitkeep`, '');
    vaultWrite(`${CONFIG.outboxDir}/.gitkeep`, '');
  }

  // Start Telegram
  try {
    const me = await bot.telegram.getMe();
    bot.botInfo = me;

    if (IS_CLOUD && CONFIG.webhookDomain) {
      // Webhook mode (for Render with custom domain or Render on-demand URL)
      const webhookUrl = `https://${CONFIG.webhookDomain}/telegraf/${bot.secretPathComponent()}`;
      await bot.telegram.setWebhook(webhookUrl);
      log(`✅ Webhook set: ${webhookUrl}`);
      // Start webhook server
      // Note: Telegraf.startWebhook handles the server
      // But we're using a custom HTTP server for the API, so we need to integrate
      // Actually, let's use polling in cloud too - simpler and works fine on Render
      bot.startPolling();
      log(`✅ Bot @${me.username} is live (webhook+API on :${CONFIG.serverPort})`);
    } else if (IS_CLOUD) {
      // Polling mode in cloud (simpler, no domain needed)
      bot.startPolling();
      log(`✅ Bot @${me.username} is live (polling + API on :${CONFIG.serverPort})`);
    } else {
      // Local mode: polling
      bot.startPolling();
      log(`✅ Bot @${me.username} is live (local polling)`);
    }
  } catch (e) {
    log(`❌ Telegram error: ${e.message}`);
    process.exit(1);
  }

  // Start REST API (cloud only)
  if (IS_CLOUD) {
    startCloudAPI(bot);
  }

  // Outbox polling (every 2 seconds)
  setInterval(() => processOutbox(bot), 2000);

  log('✅ Relay active');
}

// ================================================================
// SHUTDOWN
// ================================================================
process.once('SIGINT', () => { log('SIGINT'); bot.stop('SIGINT'); if (cloudServer) cloudServer.close(); process.exit(0); });
process.once('SIGTERM', () => { log('SIGTERM'); bot.stop('SIGTERM'); if (cloudServer) cloudServer.close(); process.exit(0); });
process.on('uncaughtException', (e) => { log(`Uncaught: ${e.message}`); });
process.on('unhandledRejection', (e) => { log(`Unhandled: ${e.message}`); });

start();
