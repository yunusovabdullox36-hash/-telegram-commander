# 🤖 TELEGRAM BOT — SETUP & DEPLOYMENT GUIDE

**Status:** Ready for testing and deployment  
**Version:** 5.1.0  
**Created:** 2026-07-06

---

## 🔧 QUICK SETUP (LOCAL TESTING)

### Step 1: Get GEMINI_API_KEY

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **"Create API Key"**
3. Copy the key (starts with `AIza...`)

### Step 2: Update .env

```bash
cd C:\Users\user\Projects\telegram-commander
# Edit .env and set:
GEMINI_API_KEY=AIzaSyC... # Your actual key
```

### Step 3: Run Bot Locally

```bash
npm start
# Output:
# ========================================
#   Telegram Commander v5.0 — MODE: LOCAL
#   Natural Language PC Control
# ========================================
```

### Step 4: Test in Telegram

Send message to **@rey_asistent_bot**:
```
"Salom"
```

Expected response:
```
Assalomu alaikum! Nima kerak?
```

---

## 🧪 TEST SCENARIOS

### Test 1: Simple Chat
```
User: "Salom"
Bot: "Assalomu alaikum! Nima kerak?"
```

### Test 2: Intent Detection (Backend)
```
User: "backend API yoz"
Bot: [Detects backend intent] "Qanday API kerak?"
```

### Test 3: Intent Detection (Frontend)
```
User: "UI component yoz"
Bot: [Detects frontend intent] "Qaysi component kerak?"
```

### Test 4: Skills Query
```
User: "skills nima?"
Bot: [Lists available skills from Obsidian]
```

### Test 5: Context Persistence
```
User1: "Meni ismi Juan"
Bot: "OK, Juan! Keyin ko'rashgunimizda seni Juan deb chaqirib kelamiz"

User1: "Meni ismi nima?"
Bot: "Sening ismingiz Juan! 😊"
```

### Test 6: Long Response (HTML formatting)
```
User: "Markdown formatda JSON qo'llanma yoz"
Bot: [Response with **bold**, `code`, etc]
```

### Test 7: Error Handling
```
User: "" (empty message)
Bot: [Silently ignores]

User: [Very long text 5000+ chars]
Bot: [Response truncated + "..." ]
```

### Test 8: Per-user Context
```
User1 (ID: 123): "Meni ismi Iska"
User2 (ID: 456): "Meni ismi Miroj"

Bot remembers each user separately!
```

---

## 🚀 RAILWAY DEPLOYMENT (24/7)

### Step 1: Setup Railway Project

```bash
npm install -g @railway/cli
railway login
cd C:\Users\user\Projects\telegram-commander
railway init
```

### Step 2: Configure Environment Variables

Railway Dashboard → Variables tab:

```env
BOT_TOKEN=8859542275:AAE...
OWNER_ID=7254093696
GEMINI_API_KEY=AIzaSyC...
VAULT_PATH=/app/vault  # Railway doesn't have Obsidian, so optional
CLIENT_MODE=cloud
TIMEZONE=Asia/Tashkent
```

### Step 3: Setup Procfile (already exists)

Check `Procfile`:
```
web: node bot.js
```

### Step 4: Deploy

```bash
railway up
```

Check status:
```bash
railway status
```

View logs:
```bash
railway logs
```

---

## 🔐 ENVIRONMENT VARIABLES

| Variable | Example | Required | Notes |
|----------|---------|----------|-------|
| `BOT_TOKEN` | `8859542275:AAE...` | ✅ Yes | From @BotFather |
| `OWNER_ID` | `7254093696` | ✅ Yes | Rey's Telegram ID |
| `GEMINI_API_KEY` | `AIzaSyC...` | ✅ Yes | Google AI Studio |
| `VAULT_PATH` | `C:\Users\user\On...` | ⚠️ Local only | Obsidian vault path |
| `TIMEZONE` | `Asia/Tashkent` | ❌ No | Default: UTC |
| `CLIENT_MODE` | `local` or `cloud` | ❌ No | Default: local |
| `TELETHON_API_ID` | `123456789` | ❌ No | Optional: for /pending |
| `TELETHON_API_HASH` | `abc123...` | ❌ No | Optional: for /pending |
| `TELETHON_SESSION` | `1BVtsOH...` | ❌ No | Optional: StringSession |

---

## 📝 BOT FEATURES

### ✅ READY NOW

- [x] **Gemini 2.5 Flash** — AI responses with search grounding
- [x] **Per-user context** — Last 10 messages stored locally
- [x] **Markdown → HTML** — Nice formatting in Telegram
- [x] **Intent detection** — backend, frontend, skills, obsidian, agents
- [x] **Retry logic** — Fallback to 3.5 Flash on error
- [x] **Non-blocking** — Async architecture, doesn't block Codebuff
- [x] **Local mode** — Obsidian integration
- [x] **Cloud mode** — Railway deployment ready

### 🟡 OPTIONAL (TODO)

- [ ] **Telethon** — /pending, /draft, /send commands
- [ ] **Morning greeting** — Scheduled daily message at 08:00
- [ ] **Voice transcription** — Gemini audio API
- [ ] **Google Search grounding** — Already built-in to Gemini 2.5

---

## 🐛 TROUBLESHOOTING

### Bot not responding

```
❌ GEMINI_API_KEY not set in .env
✅ Solution: Add GEMINI_API_KEY=AIzaSyC... to .env
```

### "429 Too Many Requests"

```
❌ Hit Gemini rate limit (40 RPM free tier)
✅ Solution: Bot retries automatically with 3.5 Flash
```

### Obsidian context not saving (cloud mode)

```
❌ VAULT_PATH not accessible on Railway
✅ Solution: Normal in cloud mode. Context stored in Railway memory
```

### Telegram API error

```
❌ Wrong BOT_TOKEN
✅ Solution: Verify token from @BotFather is correct
```

---

## 📊 LOCAL TEST CHECKLIST

Before deploying to Railway, verify locally:

- [ ] Node.js 18+ installed
- [ ] `.env` file has GEMINI_API_KEY
- [ ] `npm install` completed
- [ ] `node -c bot.js` passes syntax check
- [ ] `npm start` starts without errors
- [ ] Telegram bot responds to "Salom"
- [ ] Context saves to `_Miya/Telegram/context/user_*.json`
- [ ] Long responses truncate properly
- [ ] HTML formatting works (bold, code, etc)

---

## 🔗 USEFUL LINKS

- **Telegram Bot API:** https://core.telegram.org/bots/api
- **Gemini API Docs:** https://ai.google.dev/docs
- **Railway Docs:** https://railway.app/docs
- **Project Vault:** `C:\Users\user\OneDrive\Документы\Obsidian Vault\_Miya`

---

## 🎯 NEXT STEPS

1. ✅ **Local test** (15 min)
2. ✅ **Railway deploy** (10 min)
3. 🟡 **Telethon setup** (optional, 30 min)
4. 🟡 **Morning greeting** (optional, 15 min)

---

*Last updated: 2026-07-06  
Created by: Codebuff  
Status: READY FOR TESTING*
