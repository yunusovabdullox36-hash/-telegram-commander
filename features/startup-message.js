/**
 * Startup Message — Bot ready notification
 * Sends message to Rey when bot starts
 */

const fetch = require('node-fetch');

async function sendStartupMessage(botToken, ownerChatId) {
  const message = `✅ Bot ishga tushdi! 🚀\n\nGemini 2.5 Flash ready.\nPer-user context active.\n\nMenga xabar yubor: "Salom", "backend API yoz", va h.k.`;
  
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = {
    chat_id: ownerChatId,
    text: message,
    parse_mode: 'Markdown'
  };
  
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 10000
    });
    
    if (resp.ok) {
      console.log(`[Startup] Message sent to Rey (${ownerChatId})`);
      return true;
    } else {
      const error = await resp.json();
      console.log(`[Startup] Failed to send message: ${error.description}`);
      return false;
    }
  } catch (e) {
    console.log(`[Startup] Error sending message: ${e.message}`);
    return false;
  }
}

module.exports = { sendStartupMessage };
