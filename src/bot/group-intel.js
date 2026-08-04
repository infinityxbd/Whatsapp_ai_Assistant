/**
 * Group Conversation Intelligence — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 *
 * Makes the bot behave like a natural group member instead of an obvious
 * auto-reply service:
 *   • Always replies when @mentioned, named, or replied-to
 *   • Otherwise joins only a fraction of conversations (random participation)
 *   • Ignores low-content messages ("ok", "ha", "hmm"...) and respects a
 *     per-group cooldown so it never dominates a chat
 *   • Occasionally sends a WhatsApp emoji reaction instead of a full reply
 *   • Human-like typing delay proportional to message length
 */

const { readJSON } = require('../storage/store');

// ─── Emoji pools for reactions ───
const REACT_POSITIVE = ['👍', '❤️', '👏', '🔥'];
const REACT_NEGATIVE = ['😢', '🥺', '💔'];
const REACT_QUESTION = ['🤔', '🤨'];
const REACT_FUNNY = ['😂', '😆', '🤣'];
const REACT_SHOCK = ['😮', '😳', '😱'];
const REACT_DEFAULT = ['👍', '❤️', '😂', '😮', '👏', '🔥'];

// Tiny / filler messages that never deserve a full reply (but are still
// tracked for context and may get a reaction).
const LOW_CONTENT = new Set([
  'ok', 'okay', 'k', 'kk', 'hmm', 'hm', 'acha', 'accha', 'thik', 'theek',
  'yes', 'no', 'ha', 'na', 'haha', 'lol', 'done', 'fine', 'sure', 'oh', 'oho',
  'arre', 'are', 'yep', 'yeah', 'nope', 'wow', 'kyo', 'tumi', 'apni', 'jante',
  'okh', 'khub', 'besh', 'bujhlam', 'bujhte', 'dhor', 'cholo', 'chol',
  'bhai', 'vai', 'bro', 'dude', 'bhaiya', 'bhaia', 'vaiya'
]);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickReactionEmoji(text) {
  const t = String(text || '');
  if (/[?？]/.test(t)) return pick(REACT_QUESTION);
  if (/(haha|lol|lmao|rofl|😂|😆|😁|jokes?|funny|maja|moja|hasir|hashir)/i.test(t)) return pick(REACT_FUNNY);
  if (/(thanks|thank|tnx|dhonyobad|good|nice|great|love|best|bhalo|valo|sundor|wow|awesome|perfect|👏|🔥|congrats|mubarak)/i.test(t)) return pick(REACT_POSITIVE);
  if (/(sorry|problem|issue|kharap|khub kharap|sad|depressed|kosten|tension|mrittu|danger)/i.test(t)) return pick(REACT_NEGATIVE);
  if (/[!！]/.test(t)) return pick(REACT_SHOCK);
  return pick(REACT_DEFAULT);
}

// True for emoji-only, very short or filler messages ("ok", "ha", "ok bhai",
// "yes yes"...) that never deserve a full reply.
function isLowContent(text) {
  const t = String(text || '').trim();
  if (t.length === 0) return true;
  if (t.length <= 2) return true;
  const words = t.toLowerCase().replace(/[!?.,।]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  // 1-2 filler words only → skip
  if (words.length <= 2 && words.every(w => LOW_CONTENT.has(w))) return true;
  return false;
}

// Human-like delay: time to "read" + time to "type" the reply.
// Longer messages take longer to type, capped so active groups stay snappy.
function naturalDelay(text, isGroup = true) {
  const len = String(text || '').length;
  const base = isGroup ? (900 + Math.random() * 1200) : (1200 + Math.random() * 1500);
  const typing = Math.min(len * 45, isGroup ? 2800 : 3800);
  return Math.round(base + typing);
}

// ─── Per-group cooldown state (in-memory) ───
const lastReplyAt = new Map();

function markReplied(chatId) {
  lastReplyAt.set(chatId, Date.now());
  if (lastReplyAt.size > 500) {
    const oldest = lastReplyAt.keys().next().value;
    lastReplyAt.delete(oldest);
  }
}

function withinCooldown(chatId, cooldownSec) {
  const last = lastReplyAt.get(chatId);
  if (!last) return false;
  const parsed = parseFloat(cooldownSec);
  const sec = isNaN(parsed) ? 45 : parsed; // 0 = no cooldown, null = default 45
  if (sec <= 0) return false;
  return (Date.now() - last) < sec * 1000;
}

// ─── Per-group settings ───
// config.groupSettings = { "<cleanGroupId>": { mode: 'chatty'|'normal'|'mention', chance: <0-1|null> } }
function cleanGroupId(chatId) {
  return String(chatId || '').replace(/@g\.us/, '').replace(/\D/g, '');
}

function getGroupSetting(chatId, config) {
  const gs = (config && config.groupSettings) || {};
  return gs[cleanGroupId(chatId)] || null;
}

function setGroupMode(chatId, mode, config) {
  const gs = (config && config.groupSettings) || {};
  const key = cleanGroupId(chatId);
  if (!gs[key]) gs[key] = { mode: 'normal', chance: null };
  if (['chatty', 'normal', 'mention'].includes(mode)) gs[key].mode = mode;
  return gs;
}

function setGroupChance(chatId, chance, config) {
  const gs = (config && config.groupSettings) || {};
  const key = cleanGroupId(chatId);
  if (!gs[key]) gs[key] = { mode: 'normal', chance: null };
  gs[key].chance = (chance === null || chance === undefined) ? null : Math.min(Math.max(parseFloat(chance) || 0, 0), 1);
  return gs;
}

function resetGroupSettings(chatId, config) {
  const gs = (config && config.groupSettings) || {};
  delete gs[cleanGroupId(chatId)];
  return gs;
}

// True when a message looks like a question. Careful with word lists: common
// statement words ("eta", "ota", "ke", "amra"...) must NOT count, or the
// bot gets more chatty on ordinary chatter — the opposite of natural.
const QUESTION_BANGLA_RE = /\b(ki|keno|kivabe|kemne|kon|kothay|koto|kar|kokhon|kobe|ken)\b/i;
const QUESTION_EN_RE = /\b(why|what|how|where|when|who|which)\b/i;

function isQuestion(text) {
  const t = String(text || '');
  if (/[?？]/.test(t)) return true;
  if (QUESTION_BANGLA_RE.test(t)) return true;
  if (QUESTION_EN_RE.test(t)) return true;
  // Auxiliaries only count when the sentence is clearly a question (ends ?)
  if (/[?？]$/.test(t.trim()) && /\b(can|could|should|would|will|are|is|do|does)\b/i.test(t)) return true;
  return false;
}

// Decide whether to spontaneously join a conversation (random participation).
// Per-group mode overrides the global chance; questions get a boost.
function shouldRandomReply(chatId, config, userMsg) {
  const gs = getGroupSetting(chatId, config);

  // 'mention' mode → never join spontaneously
  if (gs && gs.mode === 'mention') return false;

  let chance = parseFloat(config.groupReplyChance);
  if (isNaN(chance) || chance <= 0) chance = 0;

  // 'chatty' mode → at least 60% participation
  if (gs && gs.mode === 'chatty') chance = Math.max(chance, 0.6);
  // explicit per-group chance wins over everything
  if (gs && typeof gs.chance === 'number' && !isNaN(gs.chance)) chance = gs.chance;

  // questions are answered much more often
  if (isQuestion(userMsg)) {
    const boost = parseFloat(config.questionBoostChance);
    chance = Math.max(chance, isNaN(boost) ? 0.6 : boost);
  }

  if (chance <= 0) return false;
  if (withinCooldown(chatId, config.groupCooldownSec)) return false;
  return Math.random() < Math.min(chance, 1);
}

// True when this message is clearly directed at the bot: it is @mentioned,
// the bot's name is used, or the message is a reply to one of the bot's own
// messages. These ALWAYS get a reply (bypass cooldown + chance).
async function isBotAddressed(message, client, botState, config) {
  try {
    // 1) Explicit mention (@tag of the bot's number/LID)
    if (message.mentionedIds && message.mentionedIds.length) {
      const botDigits = String((botState && botState.botWid) || '').replace(/\D/g, '');
      for (const id of message.mentionedIds) {
        const raw = (id && id._serialized) ? id._serialized : String(id || '');
        if (botDigits && raw.replace(/\D/g, '') === botDigits) return true;
      }
    }

    // 2) Bot's name mentioned in text (word-boundary aware: "Rafi,", "@Rafi", "Rafi!")
    const cfg = config || readJSON('config.json') || {};
    const botName = String(cfg.botName || '').trim();
    if (botName.length > 1) {
      const name = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRe = new RegExp('(?:^|\\s|@)' + name + '(?=\\s|[,.;:!?]|$)', 'i');
      if (nameRe.test(String(message.body || ''))) return true;
    }

    // 3) Reply to one of the bot's own messages
    const hasQuoted = typeof message.hasQuotedMsg === 'function'
      ? await message.hasQuotedMsg()
      : !!message.hasQuotedMsg;
    if (hasQuoted) {
      const quoted = await message.getQuotedMessage();
      if (quoted && quoted.fromMe) return true;
    }
  } catch (e) {}
  return false;
}

// Build the group personality system prompt. Uses the admin-configured
// groupPrompt when set, otherwise a natural "friendly group member" persona.
// Replies are deliberately kept SHORT and casual so the bot sounds human.
function buildGroupPrompt(config) {
  const botName = (config.botName || 'AI Assistant').trim();
  const custom = (config.groupPrompt || '').trim();
  const header = `You are "${botName}", chatting in a WhatsApp group.`;
  const rules = 'Rules: reply like a real person — keep it SHORT (1-2 sentences max), casual and natural. No bullet points, no lists, no headings, no over-explaining. Never mention that you are an AI, a bot or an assistant. Use a friendly mix of Bangla/Banglish and English, with an occasional emoji. Join conversations like a friend — react to jokes, give quick opinions, ask questions sometimes.';
  if (custom) {
    return `${header}\n\n${custom}\n\n${rules}`;
  }
  return `${header}\n\nYou are a friendly, casual member of a WhatsApp group. ${rules}`;
}

// Safety net: if the AI still returns a wall of text, cut it down to the
// first two sentences so the group reply stays short and natural.
function trimToNatural(text) {
  const t = String(text || '').trim();
  if (t.length <= 300) return t;
  const m = t.match(/^[^.!?।]*[.!?।]\s*[^.!?।]*[.!?।]\s*/);
  if (m && m[0].length > 40) return m[0].trim() + '…';
  return t.slice(0, 300).trim() + '…';
}

module.exports = {
  pickReactionEmoji,
  isLowContent,
  naturalDelay,
  markReplied,
  withinCooldown,
  cleanGroupId,
  getGroupSetting,
  setGroupMode,
  setGroupChance,
  resetGroupSettings,
  isQuestion,
  shouldRandomReply,
  isBotAddressed,
  buildGroupPrompt,
  trimToNatural
};
