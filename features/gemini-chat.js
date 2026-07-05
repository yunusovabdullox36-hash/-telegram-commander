/**
 * Gemini 2.5 Flash Chat — Non-blocking, per-user context
 * 
 * Features:
 * - Gemini 2.5 Flash (primary) + 3.5 Flash (fallback)
 * - Per-user JSON context (last 10 messages)
 * - Markdown → Telegram HTML
 * - Retry logic: Flash (search) → Flash (no search) → 3.5 Flash
 * - Natural language intents (backend, frontend, skills, obsidian, agents)
 * - Non-blocking async
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// ================================================================
// CONFIG
// ================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VAULT_PATH = process.env.VAULT_PATH || 'C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault';
const CONTEXT_DIR = path.join(VAULT_PATH, '_Miya', 'Telegram', 'context');
const MAX_CONTEXT_MESSAGES = 10;  // Keep last 10 messages per user
const RETRY_DELAYS = [0, 5000, 10000]; // Exponential backoff (ms)

// Initialize context directory
if (!fs.existsSync(CONTEXT_DIR)) {
  fs.mkdirSync(CONTEXT_DIR, { recursive: true });
}

// ================================================================
// SYSTEM PROMPT
// ================================================================
function getSystemPrompt(userName = 'Foydalanuvchi') {
  const today = new Date().toLocaleDateString('uz-UZ', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  
  return `Sen Jarvis — shaxsiy AI assistent.
Foydalanuvchi ismi: ${userName}.
Bugungi sana: ${today}.

Javoblarni qisqa, aniq va foydali tarzda ber.
O'zbek yoki rus tilida javob ber.
HTML formatda javob ber (<b>, <i>, <code>, <pre> ishlatish mumkin).

Agarda "backend", "API", "database" haqida so'ralsa — @backend agentini tavsiya et.
Agarda "UI", "React", "frontend" haqida so'ralsa — @frontend agentini tavsiya et.
Agarda "skills" yoki "qabiliyt" haqida so'ralsa — Obsidian-dan skills katalogini ko'rsat.
Agarda "agent" yoki "naqta" haqida so'ralsa — agentlar ro'yxatini ko'rsat.`;
}

// ================================================================
// CONTEXT MANAGEMENT
// ================================================================
function loadContext(uid) {
  const contextFile = path.join(CONTEXT_DIR, `user_${uid}.json`);
  if (fs.existsSync(contextFile)) {
    try {
      return JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
    } catch (e) {
      console.log(`Error loading context for ${uid}: ${e.message}`);
      return [];
    }
  }
  return [];
}

function saveContext(uid, messages) {
  const contextFile = path.join(CONTEXT_DIR, `user_${uid}.json`);
  try {
    // Keep only last MAX_CONTEXT_MESSAGES
    const trimmed = messages.slice(-MAX_CONTEXT_MESSAGES);
    fs.writeFileSync(contextFile, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (e) {
    console.log(`Error saving context for ${uid}: ${e.message}`);
  }
}

function addToContext(uid, role, content) {
  const context = loadContext(uid);
  context.push({
    role,
    content,
    timestamp: new Date().toISOString()
  });
  saveContext(uid, context);
  return context;
}

// ================================================================
// MARKDOWN → TELEGRAM HTML
// ================================================================
function markdownToHtml(md) {
  if (!md) return '';
  
  let html = md
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (```...```)
    .replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    })
    // Inline code (`...`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold (**...**)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    // Italic (*...*)
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    // Preserve newlines
    .replace(/\n/g, '\n');
  
  return html;
}

// ================================================================
// INTENT DETECTION (Natural Language Commands)
// ================================================================
const intents = {
  backend: { patterns: [/backend|api|express|mongodb|database|crud/i], action: 'backend' },
  frontend: { patterns: [/frontend|ui|react|tailwind|component|page/i], action: 'frontend' },
  skills: { patterns: [/skill|qabiliyt|nima qila|orchestrate|implementation/i], action: 'skills' },
  obsidian: { patterns: [/obsidian|task|loyiha|status|daily|note/i], action: 'obsidian' },
  agents: { patterns: [/agent|naqta|qaysi|kim|@/i], action: 'agents' },
};

function detectIntent(text) {
  for (const [key, { patterns, action }] of Object.entries(intents)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return action;
      }
    }
  }
  return null; // No specific intent
}

// ================================================================
// GEMINI API CALL (with retry logic)
// ================================================================
async function callGemini(messages, model = 'gemini-2.5-flash', useSearch = false, retryCount = 0) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  
  // Build request body
  const body = {
    contents: messages.map(msg => ({
      role: msg.role === 'system' ? 'user' : msg.role, // Gemini doesn't have "system" role
      parts: [{ text: msg.content }]
    }))
  };

  // Add system prompt as first user message if not already there
  if (messages[0]?.role !== 'system') {
    body.contents.unshift({
      role: 'user',
      parts: [{ text: messages.find(m => m.role === 'system')?.content || '' }]
    });
  }

  // Add search grounding if requested
  if (useSearch) {
    body.tools = [{
      googleSearch: {}
    }];
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 30000
    });

    if (!response.ok) {
      const errorData = await response.json();
      const error = errorData.error || {};
      
      // Retry logic for rate limit (429) and server errors (503)
      if ((response.status === 429 || response.status === 503) && retryCount < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[retryCount];
        console.log(`Rate limited (${response.status}). Retrying in ${delay}ms... (attempt ${retryCount + 1})`);
        
        // Try fallback: remove search if this was search attempt
        if (useSearch && retryCount === 0) {
          return new Promise(resolve => {
            setTimeout(() => resolve(callGemini(messages, model, false, retryCount + 1)), delay);
          });
        }
        
        // Try fallback model
        if (model === 'gemini-2.5-flash' && retryCount === 1) {
          return new Promise(resolve => {
            setTimeout(() => resolve(callGemini(messages, 'gemini-3.5-flash', false, retryCount + 1)), delay);
          });
        }
        
        return new Promise(resolve => {
          setTimeout(() => resolve(callGemini(messages, model, useSearch, retryCount + 1)), delay);
        });
      }

      throw new Error(`Gemini API error: ${error.message || JSON.stringify(error)}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '(empty response)';
    
    return {
      text,
      model,
      usage: data.usageMetadata || {}
    };
  } catch (error) {
    // Fallback to simpler model on network error
    if (retryCount < RETRY_DELAYS.length && model === 'gemini-2.5-flash') {
      console.log(`Error calling ${model}: ${error.message}. Falling back to gemini-3.5-flash...`);
      return new Promise(resolve => {
        setTimeout(() => resolve(callGemini(messages, 'gemini-3.5-flash', false, retryCount + 1)), RETRY_DELAYS[retryCount]);
      });
    }
    throw error;
  }
}

// ================================================================
// MAIN CHAT FUNCTION
// ================================================================
async function chat(userMessage, uid, userName = 'Foydalanuvchi') {
  try {
    // Load context
    let context = loadContext(uid);
    
    // Convert context format for API
    const messages = context.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      content: msg.content
    }));
    
    // Add system prompt at the start
    messages.unshift({
      role: 'system',
      content: getSystemPrompt(userName)
    });
    
    // Add new user message
    messages.push({
      role: 'user',
      content: userMessage
    });
    
    // Detect intent and add context hint
    const intent = detectIntent(userMessage);
    if (intent) {
      messages[messages.length - 1].content += `\n\n[Intent: ${intent}]`;
    }
    
    // Call Gemini with search grounding
    let result = await callGemini(messages, 'gemini-2.5-flash', true);
    
    // Save to context
    addToContext(uid, 'user', userMessage);
    addToContext(uid, 'model', result.text);
    
    // Convert markdown to HTML
    const htmlResponse = markdownToHtml(result.text);
    
    return {
      text: result.text,
      html: htmlResponse,
      intent,
      model: result.model
    };
  } catch (error) {
    console.error(`Chat error for ${uid}: ${error.message}`);
    return {
      text: `❌ Error: ${error.message}`,
      html: `<b>❌ Error:</b> ${error.message}`,
      error: true
    };
  }
}

// ================================================================
// RESET CONTEXT
// ================================================================
function resetContext(uid) {
  const contextFile = path.join(CONTEXT_DIR, `user_${uid}.json`);
  try {
    if (fs.existsSync(contextFile)) {
      fs.unlinkSync(contextFile);
    }
    return true;
  } catch (e) {
    console.log(`Error resetting context for ${uid}: ${e.message}`);
    return false;
  }
}

// ================================================================
// EXPORTS
// ================================================================
module.exports = {
  chat,
  resetContext,
  loadContext,
  saveContext,
  addToContext,
  markdownToHtml,
  detectIntent,
  getSystemPrompt,
};
