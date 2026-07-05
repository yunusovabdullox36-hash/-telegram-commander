// ================================================================
// FUN MODULE — Stickers, Emojis, and Fun Responses
// ================================================================
// AI ora-chira qiziqarli stiker va emoji yuboradi
// Stickers are optional — fallback to emoji if sticker fails
// ================================================================

// ================================================================
// Fun emoji reactions for keyword matching
// ================================================================
const EMOJI_TRIGGERS = {
  '👍': ['yaxshi', 'zo\'r', 'rahm', 'a\'lo', 'ball', 'good', 'nice', 'great', 'cool', 'awesome', 'rahmat'],
  '🔥': ['fire', 'issiq', 'hot', 'yon', 'burn', 'kuy', 'qizib'],
  '💪': ['kuch', 'power', 'strong', 'muscle', 'force', 'kuchli'],
  '😎': ['cool', 'sovuq', 'salqin', 'sigma'],
  '🎉': ['tug\'ilgan', 'birthday', 'bayram', 'party', 'tabrik', 'congrat'],
  '🚀': ['deploy', 'push', 'launch', 'start', 'ishga', 'run', 'started'],
  '⚡': ['speed', 'tez', 'fast', 'quick', 'zud', 'rapid'],
  '🤖': ['bot', 'ai', 'robot', 'artificial', 'gpt'],
  '🌟': ['star', 'yulduz', 'best', 'top', 'eng yaxshi'],
  '🎯': ['target', 'goal', 'maqsad', 'hit', 'nail'],
  '👑': ['king', 'rey', 'boss', 'xo\'jayin', 'sardor'],
  '💯': ['100', 'perfect', 'to\'liq', 'full', 'complete', 'perfect'],
  '🎸': ['rock', 'metal', 'music', 'muzika', 'qo\'shiq'],
};

// ================================================================
// Fun sticker file IDs (Telegram stickers from ANIMALS pack)
// Replace these with actual sticker file_ids from your sticker packs
// These are example animated sticker IDs
// ================================================================
const FUN_STICKERS = [
  // Note: Bu sticker ID'lari ishlashi uchun bot sticker pack ga qo'shilgan bo'lishi kerak.
  // Agar ishlamasa — bot emoji bilan ishlaydi (fallback)
];

// ================================================================
// Random fun response selector (keyword-based emoji match)
// ================================================================
function getRandomFunResponse(message) {
  const lower = message.toLowerCase();

  for (const [emoji, keywords] of Object.entries(EMOJI_TRIGGERS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return { type: 'emoji', value: emoji };
      }
    }
  }

  return null;
}

// ================================================================
// Random fun reaction (15% chance for fun, or forced)
// Returns: { type: 'emoji', value: '🔥' } or null
// ================================================================
function maybeGetFunReaction(force = false) {
  if (!force && Math.random() > 0.15) return null; // 15% chance

  const reactions = [
    { type: 'emoji', value: '🔥' },
    { type: 'emoji', value: '💪' },
    { type: 'emoji', value: '🚀' },
    { type: 'emoji', value: '😎' },
    { type: 'emoji', value: '🎉' },
    { type: 'emoji', value: '⚡' },
    { type: 'emoji', value: '💯' },
    { type: 'emoji', value: '👑' },
    { type: 'emoji', value: '🎯' },
    { type: 'emoji', value: '🌟' },
    { type: 'emoji', value: '✨' },
    { type: 'sticker', value: '🎉' }, // fallback sticker
  ];

  const pick = reactions[Math.floor(Math.random() * reactions.length)];

  // Try to find a sticker if available
  if (pick.type === 'sticker') {
    return null; // No real sticker IDs yet, skip sticker path
  }

  return pick;
}

// ================================================================
// Fun reaction for special events (success, completion, etc.)
// ================================================================
function getSuccessReaction() {
  const reactions = [
    { type: 'emoji', value: '✅ Bajarildi!' },
    { type: 'emoji', value: 'Done! 👑' },
    { type: 'emoji', value: 'Zo\'r, ishladi! 💪' },
    { type: 'emoji', value: '🎉 All good!' },
  ];
  return reactions[Math.floor(Math.random() * reactions.length)];
}

function getErrorReaction() {
  const reactions = [
    { type: 'emoji', value: 'Hm, xatolik chiqdi. Qaytadan urunaman... 🔄' },
    { type: 'emoji', value: 'Oops! Something went wrong.' },
    { type: 'emoji', value: 'Xatolik: boshqa usul bilan harakat qilamiz 🔄' },
  ];
  return reactions[Math.floor(Math.random() * reactions.length)];
}

module.exports = {
  FUN_STICKERS,
  getRandomFunResponse,
  maybeGetFunReaction,
  getSuccessReaction,
  getErrorReaction,
};
