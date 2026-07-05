// ================================================================
// Telegram Commander v5.0 — NATURAL LANGUAGE FIRST
// ================================================================
// Rey <-> Telegram <-> AI (Function Calling) <-> PC/Chrome/GitHub
// 
// V5.0 UPGRADE:
//   - No commands needed! Just talk naturally (erkin gap)
//   - All messages go through AI with function calling tools
//   - Controls: PC, Chrome, GitHub, Obsidian, Power, Files
//   - Wake-on-LAN support, sleep prevention
//   - Full backward compatibility with existing commands
//
// MODE=local (default):  Full PC control
// MODE=cloud:            JSON queue + REST API (Render)
// ================================================================

// LOAD .env file
require('dotenv').config();

const { Telegraf } = require('telegraf');
const https = require('https');
const fs = require('fs');
const path = require('path');
const http = require('http');
const fetch = require('node-fetch');

// ================================================================
// FEATURE MODULES
// ================================================================
const remote = require('./features/remote');
const imagegen = require('./features/imagegen');
const aichat = require('./features/aichat');
const geminiChat = require('./features/gemini-chat');  // NEW: Gemini 2.5 Flash + context
const files = require('./features/files');
const aiFunctions = require('./features/ai-functions');
const browser = require('./features/browser');
const github = require('./features/github');
const wol = require('./features/wakeonlan');
const fun = require('./features/fun');
const monitor = require('./features/obsidian-monitor');
const { sendStartupMessage } = require('./features/startup-message');  // NEW: Send startup notification
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
  dataDir: path.join(__dirname, 'data'),
  maxRatePerSec: 20,
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
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    const waitMs = Math.ceil((1 / this.maxPerSec) * 1000);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return this.acquire();
  }
}
const rateLimiter = new RateLimiter(CONFIG.maxRatePerSec);

// ================================================================
// STORAGE
// ================================================================
const vaultPathFn = (relative) => path.join(CONFIG.vaultPath, relative);

function vaultRead(relative) {
  const fp = vaultPathFn(relative);
  try { return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : null; }
  catch (e) { return null; }
}
function vaultWrite(relative, content) {
  const fp = vaultPathFn(relative);
  try {
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, content, 'utf-8');
    return true;
  } catch (e) { return false; }
}
function vaultDelete(relative) {
  const fp = vaultPathFn(relative);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); return true; }
  catch (e) { return false; }
}
function vaultList(dir) {
  const fp = vaultPathFn(dir);
  try { return fs.existsSync(fp) ? fs.readdirSync(fp).filter(f => f.endsWith('.md')).sort() : []; }
  catch (e) { return []; }
}
function vaultAppend(relative, content) {
  const fp = vaultPathFn(relative);
  try {
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(fp, content, 'utf-8');
    return true;
  } catch (e) { return false; }
}

// --- CLOUD MODE: JSON Queue ---
let messageQueue = [];
let outboxQueue = [];
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const OUTBOX_FILE = path.join(__dirname, 'data', 'outbox.json');

function cloudInit() {
  if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  try { if (fs.existsSync(MESSAGES_FILE)) messageQueue = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8')); } catch (e) { messageQueue = []; }
  try { if (fs.existsSync(OUTBOX_FILE)) outboxQueue = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf-8')); } catch (e) { outboxQueue = []; }
}
function cloudSaveMessages() {
  try { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messageQueue, null, 2), 'utf-8'); } catch (e) { log(`Save messages error: ${e.message}`); }
}
function cloudSaveOutbox() {
  try { fs.writeFileSync(OUTBOX_FILE, JSON.stringify(outboxQueue, null, 2), 'utf-8'); } catch (e) { log(`Save outbox error: ${e.message}`); }
}

// ================================================================
// SCREENSHOT
// ================================================================
let screenshotModule = null;
try {
  screenshotModule = require('screenshot-desktop');
  log('Camera/Screenshot module loaded');
} catch (e) {
  log('Screenshot module not available (optional)');
}
function isScreenshotAvailable() {
  return screenshotModule !== null && typeof screenshotModule === 'function';
}

// ================================================================
// MESSAGE HANDLING
// ================================================================
function saveIncomingMessage(text, msgId, ts) {
  if (IS_LOCAL) {
    const filename = `${ts.replace(/[:.]/g, '-')}-${msgId}.md`;
    const content = `---\nfrom: ${CONFIG.ownerId}\nmsg_id: ${msgId}\nts: ${ts}\n---\n\n${text}\n`;
    vaultWrite(`${CONFIG.inboxDir}/${filename}`, content);
    const today = ts.split('T')[0];
    vaultAppend(`_Miya/Daily/${today}.md`, `\n## Telegram — ${ts}\n> ${text}\n`);
  } else {
    messageQueue.push({ text, msgId, ts, from: CONFIG.ownerId });
    cloudSaveMessages();
  }
}

async function processOutbox(bot) {
  if (IS_LOCAL) {
    const filesList = vaultList(CONFIG.outboxDir);
    if (filesList.length === 0) return;
    const batch = filesList.slice(0, CONFIG.outboxBatchSize);
    for (const f of batch) {
      const content = vaultRead(`${CONFIG.outboxDir}/${f}`);
      if (!content) { vaultDelete(`${CONFIG.outboxDir}/${f}`); continue; }
      const msgIdMatch = content.match(/^target_msg_id:\s*(\d+)$/m);
      const targetMsgId = msgIdMatch ? parseInt(msgIdMatch[1]) : undefined;
      const isScreenshot = content.includes('__SCREENSHOT__');
      await rateLimiter.acquire();
      try {
        if (isScreenshot) {
          if (isScreenshotAvailable()) {
            const img = await screenshotModule({ format: 'png' });
            await bot.telegram.sendPhoto(CONFIG.ownerId, { source: img });
          } else {
            await bot.telegram.sendMessage(CONFIG.ownerId, 'Screenshot not available');
          }
        } else {
          const cleanContent = content.replace(/^---[\s\S]*?---\n\n/, '').trim();
          if (cleanContent) {
            await bot.telegram.sendMessage(CONFIG.ownerId, cleanContent, { reply_to_message_id: targetMsgId });
          }
        }
      } catch (e) {
        log(`Send error: ${e.message}`);
        if (e.response && e.response.statusCode === 429) {
          const retryAfter = e.response.parameters?.retry_after || 5;
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        }
      }
      vaultDelete(`${CONFIG.outboxDir}/${f}`);
    }
  } else {
    const pending = outboxQueue.splice(0, CONFIG.outboxBatchSize);
    cloudSaveOutbox();
    for (const item of pending) {
      await rateLimiter.acquire();
      try {
        if (item.type === 'text') {
          await tgSend(CONFIG.ownerId, item.text, { reply_to_message_id: item.replyTo });
        } else if (item.type === 'screenshot') {
          await tgSend(CONFIG.ownerId, 'Screenshot not available in cloud mode');
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

// ================================================================
// NATURAL LANGUAGE PROCESSOR — THE CORE UPGRADE
// ================================================================
// All messages go through AI with function calling.
// No commands needed — just talk naturally!
// ================================================================

let userMessageHistory = [];

async function processWithAI(userText, ctx, isCloud = false) {
  try {
    userMessageHistory.push({ role: 'user', content: userText });
    if (userMessageHistory.length > 10) {
      userMessageHistory = userMessageHistory.slice(-10);
    }

    // Track if AI is available
    const hasApiKey = !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);

    if (!hasApiKey) {
      return await fallbackResponse(userText);
    }

    // Send to AI with tools (function calling)
    const result = await aichat.aiChatWithTools(
      userText,
      aiFunctions.tools,
      aiFunctions.SYSTEM_PROMPT,
      userMessageHistory.slice(0, -1)
    );

    if (result.error) {
      userMessageHistory.push({ role: 'assistant', content: result.error });
      return await fallbackResponse(userText);
    }

    let responseText = result.text || '';

    // Execute any tool calls from AI
    if (result.toolCalls && result.toolCalls.length > 0) {
      userMessageHistory.push({
        role: 'assistant',
        content: responseText + '\n[Executing tools...]',
      });

      for (const call of result.toolCalls) {
        const toolResult = await aiFunctions.executeTool(call.name, call.args);

        // Handle special results (screenshots, images)
        if (toolResult && typeof toolResult === 'object') {
          if (toolResult._screenshot) {
            try {
              const img = await remote.takeScreenshot();
              await ctx.replyWithPhoto({ source: img }, {
                caption: `Screenshot: ${new Date().toLocaleString()}`,
              });
              responseText += `\n\nScreenshot taken!`;
              continue;
            } catch (e) {
              responseText += `\n\nScreenshot failed: ${e.message}`;
              continue;
            }
          }
          if (toolResult._image) {
            try {
              const buffer = Buffer.from(toolResult.buffer, 'base64');
              await ctx.replyWithPhoto({ source: buffer }, { caption: toolResult.caption || 'Photo' });
              responseText += `\n\nPhoto taken!`;
              continue;
            } catch (e) {
              responseText += `\n\nCamera error: ${e.message}`;
              continue;
            }
          }
        }

        const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
        userMessageHistory.push({
          role: 'function',
          name: call.name,
          content: resultStr.substring(0, 1500),
        });

        responseText += `\n${resultStr.substring(0, 500)}`;
      }

      // Get final summary
      if (result.toolCalls.length > 0) {
        try {
          const summaryResult = await aichat.aiChat(
            `Summarize what was done. User asked: "${userText}". Tool results shown above. Be brief and natural in Uzbek.`,
            { system: 'You summarize tool execution results concisely in Uzbek (or the user\'s language).', maxTokens: 500 }
          );
          if (!summaryResult.error && summaryResult.text) {
            responseText = summaryResult.text;
          }
        } catch (e) {}
      }
    }

    userMessageHistory.push({ role: 'assistant', content: responseText });
    return responseText;

  } catch (e) {
    log(`AI processing error: ${e.message}`);
    return await fallbackResponse(userText);
  }
}

// Simple keyword-based fallback when AI is unavailable
async function fallbackResponse(text) {
  const lower = text.toLowerCase();

  // Status queries
  if (lower.includes('status') || lower.includes('holat') || lower.includes('nima gap') ||
      lower.includes('ishlar') || lower === 'salom' || lower.includes('assalomu') ||
      lower.includes('qandaysan') || lower.includes('nima qilyapti') || lower.includes('ishlayapti')) {
    const status = await remote.getPCStatus();
    return (
      `Reyning yordamchisi!\n\n` +
      `PC: ${status.hostname}\n` +
      `Uptime: ${status.uptime}\n` +
      `CPU: ${status.cpuLoad}\n` +
      `RAM: ${status.memory}\n` +
      `Browser: Chrome/Edge ready\n` +
      `GitHub: ${github.isGhAvailable() ? 'ready' : 'CLI not found'}\n\n` +
      `Erkin gap bilan buyruq bering!`
    );
  }

  // Help
  if (lower.includes('yordam') || lower === '/help' || lower.includes('help') || lower.includes('nima qila olasan')) {
    const hasAi = !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
    return (
      `Reyning AI Yordamchisi v5.0\n\n` +
      `Men bilan erkin gaplashing! Hech qanday buyruq kerak emas.\n\n` +
      `Nima qila olaman:\n` +
      `PC: "Statusni korsat", "Screenshot ol", "Kompyuterni ochir"\n` +
      `Chrome: "GitHub ni och", "Google dan Node.js ni qidir", "YouTube da video qidir"\n` +
      `GitHub: "Repolarimni korsat", "Issue yarat", "Git status"\n` +
      `Power: "30 daqiqa uxlatma", "Normal uyqu rejimiga qaytar"\n` +
      `Files: "Fayllarni korsat", "Faylni oqi"\n` +
      `Obsidian: "Context ni korsat"\n\n` +
      `AI: ${hasAi ? 'Ulangan' : 'Kalit sozlanmagan (faqat basic rejim)'}`
    );
  }

  // Screenshot
  if (lower.includes('screenshot') || lower.includes('ekran') || lower.includes('rasm') || lower.includes('skrin')) {
    return { _takeScreenshot: true, text: 'Screenshot olinyapti...' };
  }

  // Shutdown
  if (lower.includes('ochir') && (lower.includes('kompyuter') || lower.includes('pc') || lower.includes('noutbuk'))) {
    const result = await remote.shutdownPC(60);
    return `Kompyuter 60 soniyadan keyin o'chadi. Bekor qilish: "Bekor qil" yoki /cancel\n${result}`;
  }

  // Default
  return `Xabar qabul qilindi: "${text.substring(0, 100)}"\nAI kaliti sozlanmagan. OPENAI_API_KEY ni o'rnating yoki /help ni bosing.`;
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
// REST API (Cloud mode)
// ================================================================
let cloudServer = null;
let pollingIntervals = [];
let lastUpdateId = 0;

function startCloudAPI(telegrafBot, useWebhook) {
  const app = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${CONFIG.serverPort}`);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok', mode: 'cloud', version: '5.0',
        bot: telegrafBot?.botInfo ? `@${telegrafBot.botInfo.username}` : 'init',
        uptime: process.uptime(),
        queuedMessages: messageQueue.length,
        queuedOutbox: outboxQueue.length,
        webhook: useWebhook ? 'active' : 'polling',
      }));
      return;
    }

    if (pathname === '/api/messages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: [...messageQueue] }));
      return;
    }

    if (pathname === '/api/messages/ack' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { msgIds } = JSON.parse(body);
          if (Array.isArray(msgIds)) messageQueue = messageQueue.filter(m => !msgIds.includes(m.msgId));
          cloudSaveMessages();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, remaining: messageQueue.length }));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }

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
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }

    // AI Chat endpoint
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

    // PC Status
    if (pathname === '/api/pcstatus') {
      (async () => {
        if (!IS_LOCAL) { res.writeHead(200); res.end(JSON.stringify({ mode: 'cloud', message: 'PC not available in cloud mode' })); return; }
        try {
          const status = await remote.getPCStatus();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      })();
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  cloudServer = app.listen(CONFIG.serverPort, '0.0.0.0', () => {
    log(`Cloud API running on port ${CONFIG.serverPort}`);
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

// ================================================================
// COMPATIBLE COMMANDS — Keep basic commands for convenience
// But the MAIN mode is natural language!
// ================================================================
bot.command('start', async (ctx) => {
  const hasAi = !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
  await ctx.reply(
    `Assalomu alaykum, Rey! 🤖\n\n` +
    `Men sizning AI yordamchingiz! Erkin gap bilan gapiring.\n` +
    `Misol: "Status", "Chrome och", "Screenshot ol", "Git repolarimni korsat"\n\n` +
    `AI: ${hasAi ? 'Ulangan' : 'Kalit sozlanmagan (basic rejim)'}\n` +
    `Mode: ${MODE.toUpperCase()}\n` +
    `/help — toliq imkoniyatlar`
  );
});

bot.command('help', async (ctx) => {
  const response = await fallbackResponse('/help');
  await ctx.reply(response, { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  const response = await fallbackResponse('status');
  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// ================================================================
// MAIN MESSAGE HANDLER — Gemini 2.5 Flash with Per-User Context
// ================================================================
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const msgId = ctx.message.message_id;
  const ts = new Date().toISOString();
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || ctx.from.username || 'Foydalanuvchi';

  log(`<- [${userId}] ${userName}: ${text.substring(0, 80)}`);

  // Save message to Obsidian
  saveIncomingMessage(text, msgId, ts);

  try {
    // Send typing action periodically
    let typingTimer = setInterval(async () => {
      try { await ctx.sendChatAction('typing'); } catch (e) {}
    }, 4000);

    try {
      // **MAIN: Use Gemini 2.5 Flash with per-user context**
      const result = await geminiChat.chat(text, userId, userName);

      if (result.error) {
        log(`Chat error: ${result.text}`);
        await ctx.reply(`❌ ${result.text}`);
        clearInterval(typingTimer);
        return;
      }

      // Log detected intent
      if (result.intent) {
        log(`  [Intent: ${result.intent}]`);
      }

      // Send response with HTML formatting
      const reply = result.html.length > 4000 
        ? result.html.substring(0, 3900) + '\n...' 
        : result.html;

      await ctx.reply(reply, {
        parse_mode: 'HTML',
        reply_to_message_id: msgId
      });

      // Log bot action to Obsidian monitor
      monitor.logBotAction('Telegram message', text.substring(0, 100)).catch(() => {});

    } finally {
      // Stop the typing indicator timer
      clearInterval(typingTimer);
    }
  } catch (e) {
    log(`Message handler error: ${e.message}`);
    await ctx.reply(`⚠️ Xatolik: ${e.message}`);
  }
});

// ================================================================
// START
// ================================================================
async function start() {
  console.log('');
  console.log('========================================');
  console.log(`  Telegram Commander v5.0 — MODE: ${MODE.toUpperCase()}`);
  console.log('  Natural Language PC Control');
  console.log('  Rey <-> Telegram <-> AI <-> PC/Chrome/GitHub');
  console.log('========================================');
  console.log('');

  log(`Starting in ${MODE.toUpperCase()} mode...`);

  if (IS_CLOUD) {
    cloudInit();
    startCloudAPI(bot, false);

    const initTelegram = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await tgApi('getMe', 15000);
          const me = result.result;
          bot.botInfo = { id: me.id, username: me.username };
          log(`Bot @${me.username} authenticated (attempt ${attempt})`);
          if (CONFIG.webhookDomain) {
            try {
              await tgApi(`setWebhook?url=${encodeURIComponent(`https://${CONFIG.webhookDomain}/telegraf`)}`, 10000);
              log(`Webhook set`);
            } catch (whErr) { log(`Webhook failed: ${whErr.message}`); }
          }
          return true;
        } catch (e) {
          log(`Telegram init attempt ${attempt}/3: ${e.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
        }
      }
      log('Telegram init failed after 3 attempts');
      return false;
    };

    initTelegram().then(() => log('Telegram init sequence complete'));
    startFetchPolling(bot).catch(e => log(`Poll loop: ${e.message}`));
    const outboxTimer = setInterval(() => processOutbox(bot), 2000);
    pollingIntervals.push(outboxTimer);
    log('Telegram server started');
  } else {
    // Local mode
    vaultWrite(`${CONFIG.inboxDir}/.gitkeep`, '');
    vaultWrite(`${CONFIG.outboxDir}/.gitkeep`, '');

    try {
      const me = await bot.telegram.getMe();
      bot.botInfo = me;
      log(`Bot @${me.username} connected`);
      bot.startPolling();
      const outboxTimer = setInterval(() => processOutbox(bot), 2000);
      pollingIntervals.push(outboxTimer);

      // Start PC activity monitoring
      monitor.startMonitoring();
      log('PC activity monitor started');

      log('Relay active');
      
      // Send startup message to Rey
      setTimeout(() => {
        sendStartupMessage(CONFIG.token, CONFIG.ownerId).catch(e => log(`Startup message error: ${e.message}`));
      }, 1000);
    } catch (e) {
      log(`Telegram connection failed: ${e.message}`);
      process.exit(1);
    }
  }

  log('HTTP server running');
}

// ================================================================
// HELPERS
// ================================================================
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function tgApi(method, timeoutMs = 15000) {
  const url = `https://api.telegram.org/bot${CONFIG.token}/${method}`;
  const resp = await withTimeout(fetch(url), timeoutMs, `tg.${method}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description}`);
  return data;
}

async function tgSend(chatId, text, opts = {}) {
  const params = new URLSearchParams({ chat_id: chatId, text });
  if (opts.reply_to_message_id) params.set('reply_to_message_id', opts.reply_to_message_id);
  if (opts.parse_mode) params.set('parse_mode', opts.parse_mode);
  await tgApi(`sendMessage?${params.toString()}`, 10000);
}

async function startFetchPolling(bot) {
  log('Starting fetch-based polling...');

  const pollLoop = async () => {
    let pollCount = 0;
    while (true) {
      try {
        const params = `getUpdates?timeout=30&offset=${lastUpdateId + 1}&limit=10&allowed_updates=["message"]`;
        const result = await tgApi(params, 35000);

        if (result.ok && Array.isArray(result.result)) {
          for (const update of result.result) {
            if (update.update_id > lastUpdateId) lastUpdateId = update.update_id;

            if (update.message && update.message.text) {
              const text = update.message.text;
              log(`<- ${text.substring(0, 80)}`);

              // Use Telegraf bot for processing via the text handler
              const msgId = update.message.message_id;
              const ts = new Date().toISOString();
              saveIncomingMessage(text, msgId, ts);

              await tgSend(CONFIG.ownerId,
                `Xabar qabul qilindi: "${text.substring(0, 100)}"\nAI ishlayapti...`
              );
            }
          }
        }

        pollCount++;
        if (pollCount % 10 === 0) log(`Polling: ${pollCount} cycles`);
      } catch (e) {
        log(`Poll error: ${e.message} — retry in 10s`);
        await new Promise(r => setTimeout(r, 10000));
      }
    }
  };

  while (true) {
    try { await pollLoop(); }
    catch (e) { log(`Poll loop crashed: ${e.message}, restarting in 5s...`); await new Promise(r => setTimeout(r, 5000)); }
  }
}

// ================================================================
// SHUTDOWN
// ================================================================
function shutdown(signal) {
  log(`Received ${signal}, shutting down...`);
  pollingIntervals.forEach(t => clearInterval(t));
  pollingIntervals = [];
  bot.stop(signal);
  if (cloudServer) { cloudServer.close(); cloudServer = null; }
  log('Shutdown complete');
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => { log(`Uncaught: ${e.message}`); });
process.on('unhandledRejection', (e) => { log(`Unhandled: ${e.message}`); });

start();
