// ================================================================
// Voice Processing — Download, transcribe, respond
// ================================================================
// Handles: voice/audio messages → transcription → text
// ================================================================

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// ================================================================
// Download voice/audio file from Telegram
// ================================================================
async function downloadVoice(fileUrl) {
  const ext = path.extname(fileUrl).split('?')[0] || '.ogg';
  const tmpFile = path.join(os.tmpdir(), `voice-${Date.now()}${ext}`);
  
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpFile);
    https.get(fileUrl, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        file.close();
        fs.unlinkSync(tmpFile);
        return resolve(downloadVoice(res.headers.location));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(tmpFile);
      reject(err);
    }).on('timeout', function() {
      this.destroy();
      file.close();
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      reject(new Error('Download timeout'));
    });
  });
  
  return tmpFile;
}

// ================================================================
// Transcribe audio using OpenAI Whisper API
// ================================================================
async function transcribeAudio(filePath, apiKey) {
  if (!apiKey) {
    return { text: null, filePath };
  }

  try {
    // Use native fetch with FormData (Node 18+)
    const formData = new FormData();
    const blob = new Blob([fs.readFileSync(filePath)], { type: 'audio/ogg' });
    formData.append('file', blob, 'audio.ogg');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return { text: data.text, filePath };
  } catch (e) {
    return { text: null, filePath, error: e.message };
  }
}

// ================================================================
// Text-to-Speech (optional — OpenAI TTS)
// ================================================================
async function textToSpeech(text, apiKey, voice = 'alloy') {
  if (!apiKey) throw new Error('AI_API_KEY required for TTS');

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      response_format: 'mp3',
    }),
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
  fs.writeFileSync(tmpFile, buffer);
  return tmpFile;
}

module.exports = { downloadVoice, transcribeAudio, textToSpeech };
