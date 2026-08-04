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

const fs = require('fs');
const path = require('path');

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

// True for emoji-only messages (emoji + variation selectors / skin tones / ZWJ
// sequences). Used for reaction handling instead of a full reply.
function isEmojiOnly(text) {
  const stripped = String(text || '').trim();
  // Remove all known emoji ranges and check if anything remains
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}]/gu;
  const withoutEmoji = stripped.replace(emojiRegex, '').replace(/\s/g, '');
  return withoutEmoji.length === 0;
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

// STRICT filler check used before spending an AI call on an UNCERTAIN message.
// Only 100%-obvious filler/spam is locally ignored: empty, emoji-only, "ok",
// "k", "ha", a standalone "hmm", or 1-2 words from the tiny set below.
// Anything else — even low-confidence/uncertain messages — must go to the main
// AI for a decision (the local detector is NOT allowed to skip it).
const OBVIOUS_FILLER = new Set([
  'ok', 'okay', 'k', 'kk', 'kek', 'hmm', 'hm', 'hmmm', 'ha', 'na', 'haha', 'lol',
  'lmao', 'oh', 'oho', 'aha', 'yes', 'no', 'yep', 'yeah', 'nope', 'thik', 'theek',
  'acha', 'accha', 'done', 'fine', 'sure', 'wow', 'arre', 'are'
]);

function isObviousFiller(text) {
  const t = String(text || '').trim();
  if (t.length === 0) return true;
  if (isEmojiOnly(t)) return true;
  // Short strings only count when they are literally in the filler set ("ok",
  // "k", "ha", "na"...). A standalone 2-char word like "ki" ("what?") or
  // casual "re"/"ja" is NOT 100% obvious filler and must reach the AI.
  if (t.length <= 2) return OBVIOUS_FILLER.has(t.toLowerCase());
  const words = t.toLowerCase().replace(/[!?.,।]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= 2 && words.every(w => OBVIOUS_FILLER.has(w))) return true;
  return false;
}

// Classic Levenshtein distance (short strings only — bot names are tiny).
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let cur = [i, ...Array(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev.splice(0, prev.length, ...cur);
  }
  return prev[n];
}

// Common short suffixes appended to a name in Bangla romanization, especially
// the genitive marker: "Suraiyar" = "Suraiya" + "r" ("Suraiya's").
const NAME_APPEND = new Set(['r', 'er', 're', 'ke', 'ar', 'or', 'e', 'a', 'i', 'y', 's', 'es']);

// Fuzzy bot-name detection: catches spelling variations and typos that the
// exact matcher (hasBotName) would miss — e.g. Suraiya → Suraia, Suraiyar.
// Matching is case-insensitive and tolerant of one typo (two for longer names)
// or a common Bangla suffix. This is a WEAK signal: it never forces a reply,
// it only makes sure such a message reaches the main AI instead of being
// locally ignored.
function hasLikelyBotName(text, config) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  const tokens = t.split(/[^a-z0-9]+/i).filter(Boolean);
  if (!tokens.length) return false;
  for (const name of getBotNames(config)) {
    const n = name.toLowerCase();
    if (n.length < 3) continue;
    for (const tok of tokens) {
      let word = tok.replace(/^@/, '');
      if (word.length < 3) continue;
      if (word === n) continue; // exact match is hasBotName's job
      // Genitive / common appended suffix: "suraiyar" starts with "suraiya"
      if (word.length > n.length && word.startsWith(n) && NAME_APPEND.has(word.slice(n.length))) return true;
      // Typo tolerance via edit distance — ONLY for names >= 5 chars. Short
      // names ("Rafi") are prefixes of many real names ("Rafiq", "Rahim") and
      // would false-positive; their typos are caught by the suffix rule above.
      if (n.length >= 5) {
        const maxDist = n.length >= 6 ? 2 : 1;
        if (Math.abs(word.length - n.length) <= maxDist && levenshtein(word, n) <= maxDist) return true;
      }
    }
  }
  return false;
}

// True when the bot's OWN reply appears within the last few history entries —
// the user is likely following up on it ("Accha tui koros ta ki?", "Kire,
// kos na kere"). Used as a soft hint for the main AI, never a hard decision.
function hasRecentBotReply(history) {
  const recent = (history || []).slice(-3);
  return recent.some(e => e && e.role === 'model');
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

// ─── Hybrid AI anti-spam: per-group reply rate limit ───
// Sliding 60-second window: the bot never sends more than `maxPerMinute`
// replies in a group, no matter how chatty the flow gets.
const replyTimes = new Map(); // cleanGroupId -> [timestamps]

function withinReplyRate(chatId, maxPerMinute) {
  const key = cleanGroupId(chatId);
  const max = parseInt(maxPerMinute);
  const limit = isNaN(max) ? 4 : max; // null/undefined/NaN → default 4
  if (limit <= 0) return true; // 0 = unlimited
  const now = Date.now();
  const windowStart = now - 60000;
  const times = (replyTimes.get(key) || []).filter(t => t > windowStart);
  return times.length < limit;
}

function markReplyTime(chatId) {
  const key = cleanGroupId(chatId);
  const now = Date.now();
  const times = (replyTimes.get(key) || []).filter(t => t > now - 60000);
  times.push(now);
  replyTimes.set(key, times);
  if (replyTimes.size > 500) {
    const oldest = replyTimes.keys().next().value;
    replyTimes.delete(oldest);
  }
}

// ─── Hybrid AI anti-spam: duplicate reply prevention ───
// The bot never sends the SAME reply text to a group twice within a window
// (e.g. two "Kemon aso?" questions right after each other).
const lastReplies = new Map(); // cleanGroupId -> [{text, ts}]

function normText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isDuplicateReply(chatId, text, duplicateSec) {
  const key = cleanGroupId(chatId);
  const sec = parseInt(duplicateSec);
  const window = isNaN(sec) ? 120 : sec; // null/undefined/NaN → default 120s
  if (window <= 0) return false; // 0 = disabled
  const now = Date.now();
  const norm = normText(text);
  if (!norm) return false;
  const list = (lastReplies.get(key) || []).filter(r => r.ts > now - window * 1000);
  return list.some(r => r.text === norm);
}

function rememberReply(chatId, text) {
  const key = cleanGroupId(chatId);
  const list = lastReplies.get(key) || [];
  list.push({ text: normText(text), ts: Date.now() });
  if (list.length > 30) list.shift();
  lastReplies.set(key, list);
}

// ─── Reply activity level ───
// Admin control: 'low' → half the normal participation, 'high' → 1.5x
// (capped at 1). 'normal' (default) leaves chances untouched.
function activityMultiplier(activity) {
  const a = String(activity || '').toLowerCase();
  if (a === 'low') return 0.5;
  if (a === 'high') return 1.5;
  return 1;
}

// True when a group is allowed to receive spontaneous replies. An EMPTY
// whitelist means "every group is allowed". When the whitelist is non-empty
// only the listed group IDs are allowed.
function isGroupWhitelisted(chatId, config) {
  const raw = config && config.groupWhitelist;
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const key = cleanGroupId(chatId);
  return list.some(id => cleanGroupId(id) === key);
}

// ─── Hybrid AI decision log ───
// EVERY group decision is appended to data/group-decisions.jsonl (git-ignored
// and auto-rotated) so the audit trail exists by default, per the product
// spec. The debugDecisionLogs toggle controls only the verbose console output.
function logGroupDecision(config, entry) {
  const verbose = config && config.debugDecisionLogs === true;
  const record = {
    time: new Date().toISOString(),
    msgId: entry.msgId || '',
    groupId: entry.groupId || '',
    senderId: entry.senderId || '',
    type: entry.type || 'unknown',
    target: entry.target || '',
    intent: entry.intent || '',
    confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
    aiDecision: entry.aiDecision || null,
    replyStatus: entry.replyStatus || 'none',
    message: entry.message || ''
  };
  try {
    const file = path.join(__dirname, '..', '..', 'data', 'group-decisions.jsonl');
    fs.appendFileSync(file, JSON.stringify(record) + '\n');
    // Rotate: keep only the last 2000 decision lines (bounded disk usage).
    try {
      const size = fs.statSync(file).size;
      if (size > 2 * 1024 * 1024) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(l => l.length > 0);
        if (lines.length > 2000) {
          fs.writeFileSync(file, lines.slice(-2000).join('\n') + '\n', 'utf-8');
        }
      }
    } catch (e) {}
  } catch (e) {}
  if (verbose) {
    const label = entry.replyStatus === 'replied' ? '✅' : '⏭️';
    console.log(`${label} Group decision [${entry.type}] ${entry.replyStatus} | target=${entry.target} intent=${entry.intent} conf=${entry.confidence} | "${record.message}"`);
  }
  return record;
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
const QUESTION_BANGLA_RE = /\b(ki|keno|kivabe|kemne|kemon|kamon|kon|kothay|koto|kar|kokhon|kobe|ken)\b/i;
const QUESTION_EN_RE = /\b(why|what|how|where|when|who|which)\b/i;

// First-person / self-reference markers (Bangla, Banglish and English).
// When the bot's name appears together with one of these, the speaker is
// talking about THEMSELVES — an identity question or correction like
// "Ami Nahid naki?", "Ami ki Nahid?", "Ami Nahid na", "Amake Nahid vabcho?"
// ("Am I Nahid?", "I'm not Nahid", "Do you think I'm Nahid?"). Those must
// be treated as addressed: the user IS talking to the bot, not to another
// person, so a reply is always required and never skipped.
// NOTE: explicit character-class boundaries are used instead of \b because
// \b is ASCII-only and would never match the Bangla pronouns.
const SELF_REF_RE = /(?:^|[\s,.;:!?।"'])(ami|amake|amar|amra|amader|nijer|আমি|আমাকে|আমার|আমরা|আমাদের|i|me|my|mine|myself|we|our|ours)(?=$|[\s,.;:!?।"'])/i;

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

  // Reply activity level scales the final chance (low 0.5x / high 1.5x)
  chance = Math.min(chance * activityMultiplier(config && config.replyActivity), 1);

  if (chance <= 0) return false;
  if (withinCooldown(chatId, config.groupCooldownSec)) return false;
  return Math.random() < chance;
}

// Word-boundary aware regex for the bot's name in text ("Rafi,", "@Rafi",
// "Rafi!", "Rafi-"). Case-insensitive per spec.
function buildBotNameRe(botName) {
  const name = String(botName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[\\s@("\\-\\x27\\u201C\\u2018])' + name + '(?=[\\s,.;:!?।\\-()"\\x27\\u201C\\u201D\\u2018\\u2019]|$)', 'i');
}

// True when the message uses the bot's name about the SENDER in first person
// — a self-correction / identity question like "Ami Nahid naki?", "Ami ki
// Nahid?", "Ami Nahid na", "Amake Nahid vabcho?" ("Am I Nahid?", "I'm not
// Nahid", "Do you think I'm Nahid?"). These are easily mistaken for a
// third-person mention — as if the user is talking to someone else — but they
// are clearly directed at the bot.
function isSelfReferenceIdentity(body, config) {
  const botName = String((config && config.botName) || '').trim();
  if (botName.length <= 1) return false;
  const nameRe = buildBotNameRe(botName);
  const text = String(body || '');
  return nameRe.test(text) && SELF_REF_RE.test(text);
}

// ─── Target detection helpers ───

// All names the bot answers to: config.botName + config.botAliases
// (aliases can be an array or a comma-separated string).
function getBotNames(config) {
  const names = [];
  const main = String((config && config.botName) || '').trim();
  if (main.length > 1) names.push(main);
  const aliases = config && config.botAliases;
  const list = Array.isArray(aliases) ? aliases : String(aliases || '').split(',');
  for (const a of list) {
    const s = String(a || '').trim();
    if (s.length > 1) names.push(s);
  }
  return names;
}

// True when the text mentions any of the bot's names/aliases.
function hasBotName(text, config) {
  const t = String(text || '');
  return getBotNames(config).some(n => buildBotNameRe(n).test(t));
}

// Group-wide addressing words: "keo/keu/kew" (anyone), "karo" (anyone's),
// "sobai/sabai/shobai/sokol" (everyone), or the literal "group".
const GROUP_WIDE_RE = /\b(keo|keu|kew|kao|kau|karo|sobai|sabai|shobai|sobay|sokol|sokolke|sobai ke|sabai ke)\b/i;
const GROUP_WORD_RE = /(^|\s)(group|grp|groop)(\s|$)/i;

// True when the message is aimed at the whole group rather than one person
// ("Keo aso?", "Sobai kemon aso?", "Kew ki jane?", "Group a keo ache?").
function isGroupAddressed(text) {
  const t = String(text || '');
  return GROUP_WIDE_RE.test(t) || GROUP_WORD_RE.test(t);
}

const GREETING_RE = /\b(hi+|hello|helo|hlo|hallo|hey|salam|assalamu|assalam|walaikum|alaikum|shagotom|swagatom|good morning|good afternoon|good evening|good night|nomoshkar|namaste)\b/i;

function isGreeting(text) {
  return GREETING_RE.test(String(text || ''));
}

// ─── Group participant names (cached, short TTL) ───
// Used only to detect messages clearly directed at ANOTHER member
// ("Rahim koi?") so the bot stays silent during private conversations.
const participantCache = new Map();
const PARTICIPANT_TTL = 5 * 60 * 1000;

async function getGroupParticipantNames(client, chatId) {
  try {
    const key = cleanGroupId(chatId);
    const hit = participantCache.get(key);
    if (hit && (Date.now() - hit.ts) < PARTICIPANT_TTL) return hit.names;
    if (!client || !chatId) return [];
    let names = [];
    const chat = await client.getChatById(chatId);
    if (chat && typeof chat.getParticipants === 'function') {
      const parts = await chat.getParticipants();
      names = (parts || []).map(p => (p && (p.pushname || p.name || (p.id && p.id.user))) || '').filter(Boolean);
    } else if (chat && Array.isArray(chat.participants)) {
      names = chat.participants.map(p => (p && p.id && p.id.user) || '').filter(Boolean);
    }
    participantCache.set(key, { names, ts: Date.now() });
    return names;
  } catch (e) {
    return [];
  }
}

// Names/surname fragments too generic to treat as a direct address.
const NAME_STOP = new Set(['bhai', 'vai', 'bro', 'dude', 'bhaiya', 'vaiya', 'md', 'mr', 'mrs', 'khan', 'sir', 'boss', 'friend', 'friends', 'bondhu', 'dost', 'sathi', 'bhalo', 'valo']);

// True when the message is clearly directed at a specific participant
// ("Rahim koi?", "Karim tui kothay?", "Mahdi amar sathe kotha bol").
// First-person self-introductions ("Ami Rahim", "amar nam Rahim") are NOT
// counted — the speaker is talking about themselves, not to that person.
function isDirectedToSpecificUser(text, botNames, participantNames) {
  const t = String(text || '');
  const names = (participantNames || []).map(n => String(n || '').trim()).filter(n => n.length >= 3);
  if (names.length === 0) return false;

  // "Ami Rahim" / "amar nam Rahim" — the name belongs to the SPEAKER here.
  const selfIntro = t.match(/\b(?:ami|amar|amr|amake|i'?m|i am|my name is|my name)\s+([a-zA-Z][a-zA-Z' -]{1,24})/i);
  if (selfIntro && selfIntro[1]) {
    const introWord = selfIntro[1].trim().split(/\s+/)[0].toLowerCase();
    if (names.some(n => n.toLowerCase() === introWord)) return false;
  }

  const botLower = botNames.map(n => n.toLowerCase());
  for (const raw of names) {
    const name = raw.toLowerCase();
    if (botLower.includes(name)) continue; // bot's own name never counts
    if (buildBotNameRe(raw).test(t)) return true;
    // Multi-word pushnames: match significant individual tokens too.
    for (const tok of raw.split(/\s+/)) {
      if (tok.length >= 3 && !NAME_STOP.has(tok.toLowerCase())) {
        if (buildBotNameRe(tok).test(t)) return true;
      }
    }
  }
  return false;
}

// ─── Message target classifier ───
// Classifies a group message and returns structured signals. Decision
// priority (from the product spec):
//   1. Direct reply to bot message        → target: bot
//   2. Bot name/alias mentioned           → target: bot
//   3. Correction of bot misunderstanding → target: bot
//   4. Open group question/general message → target: group
//   5. Specific participant mentioned     → target: specific_user
//   6. Unclear short message              → main AI decides with context
// Signals include the bot's own WID, quoted-message metadata, configured
// aliases, group participant names and recent history.
async function classifyGroupMessage(message, client, botState, config, ctx = {}) {
  const body = String(message.body || '');
  const history = ctx.history || [];
  const botNames = getBotNames(config);

  // 1) Reply metadata: quoted message belongs to the bot
  let isReplyToBot = false;
  try {
    const hasQuoted = typeof message.hasQuotedMsg === 'function'
      ? await message.hasQuotedMsg()
      : !!message.hasQuotedMsg;
    if (hasQuoted) {
      const quoted = await message.getQuotedMessage();
      const botDigits = String((botState && botState.botWid) || '').replace(/\D/g, '');
      if (quoted && (quoted.fromMe || (botDigits && quoted.author && String(quoted.author).replace(/\D/g, '') === botDigits))) {
        isReplyToBot = true;
      }
    }
  } catch (e) {}

  // @mention of the bot's number/LID
  let isMentioned = false;
  if (message.mentionedIds && message.mentionedIds.length) {
    const botDigits = String((botState && botState.botWid) || '').replace(/\D/g, '');
    for (const id of message.mentionedIds) {
      const raw = (id && id._serialized) ? id._serialized : String(id || '');
      if (botDigits && raw.replace(/\D/g, '') === botDigits) { isMentioned = true; break; }
    }
  }

  const isReaction = isEmojiOnly(body);
  const hasName = hasBotName(body, config);
  // Weak bot-name signal: a likely typo/variation ("Suraia", "Suraiyar" for
  // "Suraiya"). Never forces a reply — only routes the message to the main AI
  // so the AI can decide instead of the local detector ignoring it.
  const likelyBotName = !hasName && hasLikelyBotName(body, config);
  const isSelfCorrection = isSelfReferenceIdentity(body, config);
  const isGroupWide = isGroupAddressed(body);
  const isQ = isQuestion(body);

  let intent = 'casual';
  if (isReaction) intent = 'reaction';
  else if (isSelfCorrection) intent = 'correction';
  else if (isQ) intent = 'question';
  else if (isGreeting(body)) intent = 'greeting';

  let target = 'unknown';
  let shouldReply = false;
  let confidence = 0;
  let continuation = false;

  // Priority 1: direct reply to the bot's own message
  if (isReplyToBot) {
    target = 'bot';
    confidence = isReaction ? 0.7 : 0.95;
    // Reactions are interaction but a full reply is config-controlled.
    shouldReply = !isReaction;
  }
  // Priority 2: bot name / alias mentioned (also covers @mentions)
  else if (isMentioned || hasName) {
    target = 'bot';
    confidence = 0.9;
    shouldReply = true;
  }
  // Priority 3: correction of a previous bot misunderstanding (first-person
  // use of the bot's name: "Ami Nahid naki?"). Kept explicit per spec.
  else if (isSelfCorrection) {
    target = 'bot';
    confidence = 0.85;
    shouldReply = true;
  }
  // Priority 4: open group question / general chat addressed to everyone
  else if (isGroupWide) {
    target = 'group';
    // Group-wide QUESTIONS get the dedicated 'open_question' intent. The bot
    // is a group member, so these always deserve a reply — never skipped just
    // because the bot's name isn't mentioned. Casual group chatter keeps a
    // generic intent and stays chance-based in the handler.
    intent = isQ ? 'open_question' : (intent === 'greeting' ? 'greeting' : 'casual');
    confidence = isQ ? 0.8 : 0.6;
    shouldReply = true; // handler may still apply chance for non-question chatter
  }
  // Priority 5: specific participant mentioned → stay silent
  else {
    const participantNames = await getGroupParticipantNames(client, message.from);
    if (participantNames.length && isDirectedToSpecificUser(body, botNames, participantNames)) {
      target = 'specific_user';
      confidence = 0.75;
      shouldReply = false;
    } else {
      // Priority 6: unclear message. The local classifier never forces a
      // "bot-addressed" decision here: a person's name does NOT mean the bot
      // is being called, and casual words like "tui"/"koi"/"re"/"ja" never
      // mean the message is for the bot. Whether the user is continuing a
      // conversation with the bot or chatting with another member is left to
      // the main AI, which sees the full context. A likely bot-name typo bumps
      // the confidence a little but still goes to the AI for a decision — low
      // confidence alone never causes a local skip.
      continuation = hasRecentBotReply(history);
      target = 'unknown';
      confidence = likelyBotName ? 0.45 : 0.3;
      shouldReply = false;
    }
  }

  return {
    isReplyToBot,
    isMentioned,
    hasBotName: hasName,
    likelyBotName,   // weak: typo/variation of the bot's name → route to AI
    isReaction,
    isSelfCorrection,
    isGroupWide,
    target,          // 'bot' | 'group' | 'specific_user' | 'unknown'
    intent,          // 'question' | 'open_question' | 'greeting' | 'correction' | 'reaction' | 'casual'
    shouldReply,     // whether the message deserves a reply (chance applied by caller)
    confidence,      // 0..1
    continuation     // true when recent-context continuation with the bot
  };
}

// Build the group personality system prompt. Uses the admin-configured
// groupPrompt when set, otherwise a natural "friendly group member" persona.
// Replies are deliberately kept SHORT and casual so the bot sounds human.
function buildGroupPrompt(config) {
  const botName = (config.botName || 'AI Assistant').trim();
  const custom = (config.groupPrompt || '').trim();
  const header = `You are "${botName}", chatting in a WhatsApp group.`;
  const rules = `Rules: reply like a real person — keep it SHORT (1-2 sentences max), casual and natural. No bullet points, no lists, no headings, no over-explaining. Never mention that you are an AI, a bot or an assistant. Use a friendly mix of Bangla/Banglish and English, with an occasional emoji. Join conversations like a friend — react to jokes, give quick opinions, ask questions sometimes. When someone uses your name about THEMSELVES in first person ("Ami ${botName} naki?", "Ami ki ${botName}?", "Ami ${botName} na", "Amake ${botName} vabcho?") they are talking to YOU and want to clear up an identity mix-up — reply briefly and playfully, never treat your own name in a first-person question as if it were another person.`;
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
  isEmojiOnly,
  isLowContent,
  isObviousFiller,
  hasLikelyBotName,
  hasRecentBotReply,
  naturalDelay,
  markReplied,
  withinCooldown,
  withinReplyRate,
  markReplyTime,
  isDuplicateReply,
  rememberReply,
  activityMultiplier,
  isGroupWhitelisted,
  logGroupDecision,
  cleanGroupId,
  getGroupSetting,
  setGroupMode,
  setGroupChance,
  resetGroupSettings,
  isQuestion,
  shouldRandomReply,
  isSelfReferenceIdentity,
  getBotNames,
  hasBotName,
  isGroupAddressed,
  isGreeting,
  getGroupParticipantNames,
  isDirectedToSpecificUser,
  classifyGroupMessage,
  buildGroupPrompt,
  trimToNatural
};
