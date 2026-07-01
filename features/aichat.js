// ================================================================
// AI Chat + CLI Integration — OpenAI-compatible API + Local CLI
// ================================================================
// Commands: /ai, /ask, /opencode, /gemini, /copilot
// ================================================================

const { spawn, execSync } = require('child_process');
const https = require('https');
const path = require('path');

// ================================================================
// OpenAI-compatible Chat
// ================================================================
async function aiChat(prompt, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  const model = opts.model || process.env.AI_MODEL || 'gpt-4o-mini';
  const baseUrl = opts.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const systemPrompt = opts.system || 'You are a helpful assistant. Keep responses concise but informative.';
  const maxTokens = opts.maxTokens || 2000;

  if (!apiKey) {
    return { error: 'AI_API_KEY not configured. Set OPENAI_API_KEY or AI_API_KEY env var.' };
  }

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
  });

  const data = await jsonFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  }, 60000);

  if (data.error) {
    return { error: `AI API error: ${data.error.message || JSON.stringify(data.error)}` };
  }

  const text = data.choices?.[0]?.message?.content?.trim() || '(empty response)';
  return { text, model: data.model, usage: data.usage };
}

// ================================================================
// CLI Integration — Run OpenCode, Gemini CLI, Copilot CLI
// ================================================================
function runCLI(cliName, prompt, opts = {}) {
  return new Promise((resolve) => {
    const timeout = opts.timeout || 120000;
    const cwd = opts.cwd || process.cwd();

    // Find the CLI binary
    let cliPath = null;
    const possiblePaths = [
      cliName,
      path.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\user', 'AppData', 'Local', 'Programs', cliName, `${cliName}.exe`),
      path.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\user', 'AppData', 'Roaming', 'npm', `${cliName}.cmd`),
      path.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\user', '.local', 'bin', cliName),
    ];
    
    for (const p of possiblePaths) {
      try {
        if (require('fs').existsSync(p)) {
          cliPath = p;
          break;
        }
      } catch (e) {}
    }

    if (!cliPath) {
      return resolve({ error: `${cliName} CLI not found. Install it first.` });
    }

    const args = opts.args || [];
    const child = spawn(cliPath, [...args, prompt], {
      cwd,
      shell: process.platform === 'win32',
      timeout,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    
    const timer = setTimeout(() => {
      if (!done) {
        child.kill('SIGTERM');
        done = true;
        resolve({ text: stdout.trim() || stderr.trim() || '(timeout)', timedOut: true });
      }
    }, timeout);

    child.on('close', (code) => {
      if (done) return;
      clearTimeout(timer);
      done = true;
      const output = stdout.trim() || stderr.trim() || '(no output)';
      resolve({ text: output, exitCode: code });
    });

    child.on('error', (err) => {
      if (done) return;
      clearTimeout(timer);
      done = true;
      resolve({ error: err.message });
    });
  });
}

// ================================================================
// HTTP helper for JSON APIs
// ================================================================
function jsonFetch(url, options = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : require('http');

    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout,
    };

    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = { aiChat, runCLI };
