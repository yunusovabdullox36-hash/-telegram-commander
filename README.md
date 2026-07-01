# Telegram Commander Bot

Reyning agentlar tizimini (OpenCode, Codebuff, Obsidian) Telegram orqali boshqaradi.

## O'rnatish

```bash
cd "C:\Users\user\Projects\telegram-commander"
npm install
```

## Ishga tushirish

```bash
npm start
```

## Windows bilan birga avtomat ishga tushirish

```bash
npm run install-service
```

Bu buyruq Windows Task Scheduler ga vazifa qo'shadi:
- Noutbuk yoqilganda (boot da) avtomat ishga tushadi
- SYSTEM hisobida ishlaydi (user kirmasa ham)
- Eng yuqori darajadagi ruxsat bilan (HIGHEST)

## Bot buyruqlari

| Buyruq | Vazifasi |
|--------|----------|
| `/start` | Botni ishga tushirish |
| `/status` | Tizim holati |
| `/context` | Obsidian kontekst |
| `/tasks` | Tasklar ro'yxati |
| `/obsidian [yo'l]` | Obsidian fayl o'qish |
| `/write [yo'l] \| [matn]` | Obsidian ga yozish |
| `/help` | Yordam |

## Oddiy matn (natural language)

Bot quyidagilarni tushunadi:
- "status", "nima gap", "ishlar" → tizim holati
- "task: backend controller yoz" → yangi task
- "search: JWT token" → Obsidian dan qidirish
- "backend controller kerak" → task yaratish
- "?" bilan tugagan savol → oldingi kontekstdan javob

## Obsidian ulanishi

Bot Obsidian Local REST API plugin orqali ishlaydi:
1. Obsidian → Settings → Community plugins
2. Local REST API ni yoqing
3. Standart port: 27123

Agar Obsidian REST API ishlamasa, bot fayl tizimi (FS) orqali ishlashga o'tadi.

## Arxitektura

```
Telegram User (Rey)
    │
    ▼
Telegram Commander Bot
    │
    ├── Obsidian REST API / FS
    │   ├── _Miya/MAIN.md
    │   ├── _Miya/AGENTS_STATUS.md
    │   └── _Miya/AgentTown/tasks/
    │
    ├── OpenCode (task orqali)
    └── Codebuff (task orqali)
```

Hamma narsa Obsidian ga yoziladi. Agentlar task fayllarni o'qib ishlaydi.
