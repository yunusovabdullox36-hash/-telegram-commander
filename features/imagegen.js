// ================================================================
// Image Generation — Pollinations.ai (free, no API key)
// ================================================================
// Commands: /img <prompt>, /imagine <prompt>
// APIs:     Pollinations.ai (primary), Arta.ai (fallback)
// ================================================================

const https = require('https');
const http = require('http');

// ================================================================
// Pollinations.ai — Free, no API key, returns image buffer
// ================================================================
async function generatePollinations(prompt, width = 1024, height = 1024, model = 'flux') {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=true&seed=${Math.floor(Math.random() * 999999)}&private=true&enhance=true`;

  const imageBuffer = await fetchImage(url, 60000);
  return imageBuffer;
}

// ================================================================
// Arta.ai — Free fallback (Firebase-based)
// ================================================================
async function generateArta(prompt, style = 'anime') {
  // Step 1: Firebase anonymous auth
  const firebaseUrl = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=AIzaSyB3-71wG0fIt0shj0ee4fvx1shcjJHGrrQ';
  const authResult = await fetchJson(firebaseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  }, 15000);

  if (!authResult.idToken) throw new Error('Arta auth failed');
  const idToken = authResult.idToken;

  // Step 2: Submit generation
  const genUrl = 'https://img-gen-prod.ai-arta.com/api/v1/text2image';
  const formData = new URLSearchParams();
  formData.append('prompt', prompt);
  formData.append('style', style);
  formData.append('cfg_scale', '7');
  formData.append('steps', '40');
  formData.append('aspect_ratio', '1:1');

  const genResult = await fetchJson(genUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Android-Cert': '9B0971CE2C5A3EC4551B15E3AA8CA45C97C9AA23',
      'X-Firebase-Gmpid': '1:948806766299:android:f33283c857b0df436f7ae5',
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 14; SM-S908B Build/UP1A.2305.9015)',
    },
    body: formData.toString(),
  }, 30000);

  const recordId = genResult.record_id;
  if (!recordId) throw new Error('Arta: no record_id');

  // Step 3: Poll for completion (up to 60s)
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const statusUrl = `https://img-gen-prod.ai-arta.com/api/v1/text2image/${recordId}/status`;
    const statusResult = await fetchJson(statusUrl, {
      headers: { 'Authorization': `Bearer ${idToken}` },
    }, 10000);

    if (statusResult.status === 'completed' && statusResult.result?.img_url) {
      return fetchImage(statusResult.result.img_url, 30000);
    }
    if (statusResult.status === 'failed') {
      throw new Error('Arta: generation failed');
    }
  }
  throw new Error('Arta: timeout');
}

// ================================================================
// Unified image generation with fallback
// ================================================================
async function generateImage(prompt, width = 1024, height = 1024, model = 'flux') {
  // Try Pollinations first
  try {
    const img = await generatePollinations(prompt, width, height, model);
    return { buffer: img, source: 'pollinations', model };
  } catch (e) {
    // Fallback to Arta
    try {
      const img = await generateArta(prompt, 'anime');
      return { buffer: img, source: 'arta', model: 'arta' };
    } catch (e2) {
      throw new Error(`Image gen failed: Pollinations: ${e.message}, Arta: ${e2.message}`);
    }
  }
}

// ================================================================
// HTTP helpers
// ================================================================
function fetchImage(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    
    const req = mod.get(url, { timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return fetchImage(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchJson(url, options = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || { 'Content-Type': 'application/json' },
      timeout,
    };

    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    
    if (options.body) req.write(options.body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  generateImage,
  generatePollinations,
  generateArta,
};
