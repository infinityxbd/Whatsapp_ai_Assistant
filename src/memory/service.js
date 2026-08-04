/**
 * AI User Memory Service — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 *
 * Modular memory system usable by ANY AI provider:
 *   • Persistent long-term profile per WhatsApp user (data/memory.json)
 *   • In-memory short-term buffer (last N messages, NOT persisted forever)
 *   • Heuristic extraction — updates long-term only when useful info is found
 *   • Compact, token-minimal context prompt (never full history)
 *   • Privacy: /forgetme deletes a user's data; sensitive content is skipped
 */

const { readJSON, writeJSON } = require('../storage/store');

const FILE = 'memory.json';

// ─── Limits (token optimization) ───
const SHORT_TERM_MAX = 12;        // messages kept per user (in memory only)
const CONTEXT_MAX_CHARS = 1200;   // hard cap for the prompt sent to the AI
const LIST_CAP = 10;              // max items per interest/fact/preference list
const ITEM_MAX_LEN = 80;          // max chars per stored item
const ACTIVITY_CHAT_CAP = 30;     // max tracked chats in activity patterns
const INACTIVE_PRUNE_DAYS = 180;  // profiles inactive this long get removed

// ─── In-memory state ───
let cache = null;                 // { globalEnabled, users: { key: profile } }
let shortTerm = new Map();        // key -> [{ chatId, role, text, time }]
let dirty = false;
let saveTimer = null;

// ─── Helpers ───

function nowIso() { return new Date().toISOString(); }

function truncate(str, max) {
  const s = String(str || '').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function cleanPhrase(str) {
  return String(str || '')
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '')
    .trim()
    .slice(0, ITEM_MAX_LEN);
}

function addUnique(list, item, cap = LIST_CAP) {
  const clean = cleanPhrase(item);
  if (!clean || clean.length < 3) return list;
  const lower = clean.toLowerCase();
  if (list.some(x => x.toLowerCase() === lower)) return list;
  list.push(clean);
  if (list.length > cap) list.shift();
  return list;
}

// Stable memory key from any WhatsApp id (phone / LID / group author).
function getUserKey(rawId) {
  return String(rawId || '').replace(/@c\.us/g, '').replace(/@lid/g, '').replace(/@g\.us/g, '').replace(/\D/g, '');
}

function load() {
  if (cache) return cache;
  const data = readJSON(FILE);
  cache = data && typeof data === 'object'
    ? { globalEnabled: data.globalEnabled !== false, users: data.users || {} }
    : { globalEnabled: true, users: {} };
  return cache;
}

function persist() {
  const data = load();
  // Never persist short-term raw messages — keep only long-term profile data.
  writeJSON(FILE, {
    globalEnabled: data.globalEnabled,
    users: data.users
  });
}

// Debounced disk write (avoids a full JSON write on every single message).
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try { persist(); } catch (e) { console.error('❌ Memory save failed:', e.message); }
  }, 3000);
}

process.on('beforeExit', () => { try { persist(); } catch (e) {} });
// The bot restarts via process.exit(0) (hourly soft restart, /restart,
// /update, admin panel) which does NOT fire beforeExit — flush synchronously
// on 'exit' so no recent memory update is ever lost.
process.on('exit', () => { try { persist(); } catch (e) {} });
process.on('SIGTERM', () => { try { persist(); } catch (e) {} process.exit(0); });
process.on('SIGINT', () => { try { persist(); } catch (e) {} process.exit(0); });

function getProfile(key) {
  if (!key) return null;
  return load().users[key] || null;
}

function createProfile(key, rawId) {
  const profile = {
    key,
    rawId: String(rawId || '') || null,
    name: '',
    language: '',
    style: '',
    interests: [],
    facts: [],
    preferences: [],
    notes: '',                    // admin-editable notes
    memoryEnabled: true,
    createdAt: nowIso(),
    lastInteraction: null,
    activity: { totalMessages: 0, firstSeen: null, lastSeen: null, activeHours: {}, chats: {} }
  };
  load().users[key] = profile;
  return profile;
}

function getOrCreateProfile(key, rawId) {
  let p = getProfile(key);
  if (!p) p = createProfile(key, rawId);
  return p;
}

// ─── Privacy / sensitive-content filter ───
// Never store OTPs, passwords, card/bank/NID numbers or similar into memory.
// Card numbers are 15-19 digits; phone numbers (13 digits like 8801XXXXXXXXX)
// are NOT flagged so users can still share their own number safely.
const SENSITIVE_RE = /(\b(otp|pin|password|passcode|verification code|security code|cvv|cvc)\b)|((\d[ -]?){15,19})|(\b(?:bank\s*account|card|nid|national id|aadhaar|ssn|social security|passport)\s*(?:no|number)?\b)|(\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4})/i;

function isSensitive(text) {
  return SENSITIVE_RE.test(String(text || ''));
}

// ─── Heuristic extractors (cheap, no extra AI calls = token savings) ───

const BANGLA_RE = /[\u0980-\u09FF]/;
const STOP_NAMES = new Set(['ok', 'okay', 'fine', 'good', 'here', 'there', 'busy', 'sorry', 'sure', 'bhai', 'bro', 'friend', 'student']);

// Common Bangla words typed in Latin script (Banglish).
const BANGLISH_RE = /\b(ami|amra|amar|amr|tumi|tumar|tomar|apni|apnar|kori|kore|korbo|hobe|hoy|ache|ase|nai|chai|chay|jani|jana|bolte|boli|bolo|bhalo|kemon|khobor|kotha|kichu|sob|jodi|tahole|ekhon|pore|kal|ajke|aj|na|ha|pora|pori|khela|dekhi|dekho|shuni|shona|vai|bhai|dost|bondhu|koto|ki|kemne)\b/i;

function detectLanguage(text) {
  if (BANGLA_RE.test(text)) return 'bn';
  const t = String(text || '').toLowerCase();
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[a-z]/.test(t)) {
    // Bangla spoken/written in Latin script (Banglish) → still Bangla user
    if (BANGLISH_RE.test(t)) return 'bn';
    return 'en';
  }
  return '';
}

function extractName(text) {
  const t = String(text || '');
  let m = t.match(/\bmy name is ([a-zA-Z][a-zA-Z' -]{1,29})/i);
  if (m) return cleanPhrase(m[1]);
  m = t.match(/\b(?:i'?m|i am|call me) ([a-zA-Z][a-zA-Z' -]{1,29})/i);
  if (m) {
    const name = cleanPhrase(m[1]);
    if (!STOP_NAMES.has(name.toLowerCase()) && !name.includes(' ')) return name;
  }
  // Bangla sentences often spell the name in Latin script: "amar nam Rahim"
  m = t.match(/(?:amar|amr) nam (?:holo |hoy )?([a-zA-Z][a-zA-Z' \-]{1,25})/i);
  if (m) {
    const name = cleanPhrase(m[1]);
    if (!STOP_NAMES.has(name.toLowerCase())) return name;
  }
  m = t.match(/(?:amar|amr) nam (?:holo |hoy )?([\u0980-\u09FF][\u0980-\u09FF ]{1,20})/);
  if (m) return cleanPhrase(m[1]);
  m = t.match(/amake ([a-zA-Z][a-zA-Z ]{1,20}) bole dake/i);
  if (m) return cleanPhrase(m[1]);
  return '';
}

function extractInterests(text) {
  const out = [];
  const t = String(text || '');
  let m = t.match(/\bi (?:like|love|enjoy|am really into|am fond of) (?:to )?([a-z][a-z0-9' \-]{1,40})/i);
  if (m) out.push(cleanPhrase(m[1]));
  m = t.match(/\bmy (?:favourite|favorite) (?:thing|hobby|sport|subject|game|food|team|player|movie|book) is ([a-z][a-z0-9' \-]{1,40})/i);
  if (m) out.push(cleanPhrase(m[1]));
  // "ami cricket pochondo kori" — interest may be in Latin or Bangla script
  const re = /(?:ami|amra) ([\u0980-\u09FFa-zA-Z][\u0980-\u09FFa-zA-Z' \-]{0,24}) (?:pochondo kori|bhalobashi|khub pochondo|valo lagbe)/g;
  let mm;
  while ((mm = re.exec(t)) !== null) out.push(cleanPhrase(mm[1]));
  return out.map(x => truncate(x.replace(/^(to|the|a|an)\s+/i, ''), 50)).filter(Boolean);
}

function extractPreferences(text) {
  const out = [];
  const t = String(text || '');
  // Keep captures short (max ~3 words) so a preference never swallows the
  // rest of the sentence.
  // Max 2 words so a preference never swallows the rest of the sentence.
  let m = t.match(/\bi (?:prefer|would rather like|like to|want to) ([a-z]+(?: [a-z]+)?)/i);
  if (m) out.push('Prefers: ' + cleanPhrase(m[1]));
  m = t.match(/\bi (?:don'?t|do not) (?:like|want|prefer) ([a-z]+(?: [a-z]+)?)/i);
  if (m) out.push('Dislikes: ' + cleanPhrase(m[1]));
  m = t.match(/(?:ami|amra) chai ([\u0980-\u09FFa-zA-Z][\u0980-\u09FFa-zA-Z' \-]{0,20})/);
  if (m) out.push('Wants: ' + cleanPhrase(m[1]));
  return out.map(x => truncate(x, 55)).filter(Boolean);
}

function extractFacts(text) {
  const out = [];
  const t = String(text || '');
  let m = t.match(/\bi(?:'m| am) (?:a |an )?(student|teacher|doctor|engineer|developer|programmer|designer|lawyer|nurse|driver|farmer|businessman|businesswoman|soldier|police|officer|banker|accountant|chef|carpenter|plumber|electrician|mechanic)\b/i);
  if (m) out.push('Is a ' + m[1].toLowerCase());
  m = t.match(/\bi (?:work|w?ork) (?:at|for|in) ([a-z][a-z0-9' &.\-]{1,40})/i);
  if (m) out.push('Works at ' + cleanPhrase(m[1]));
  m = t.match(/\bi (?:study|read) at ([a-z][a-z0-9' &.\-]{1,40})/i);
  if (m) out.push('Studies at ' + cleanPhrase(m[1]));
  m = t.match(/\bi live in ([a-z][a-z0-9' \-]{1,40})/i);
  if (m) out.push('Lives in ' + cleanPhrase(m[1]));
  m = t.match(/\bi(?:'m| am) from ([a-z][a-z0-9' \-]{1,40})/i);
  if (m) out.push('From ' + cleanPhrase(m[1]));
  m = t.match(/\bi(?:'m| am) (\d{1,2}) (?:years? )?old/i);
  if (m) out.push(m[1] + ' years old');
  m = t.match(/(?:amar|amr) bari ([\u0980-\u09FF ]{1,20})/);
  if (m) out.push('Home: ' + cleanPhrase(m[1]));
  return out.map(x => truncate(x, 70)).filter(Boolean);
}

function detectStyle(text) {
  const t = String(text || '').toLowerCase();
  const tags = [];
  if (/\b(assalamu alaikum|assalamualaikum|walaikum salam|salam)\b/.test(t)) tags.push('respectful, uses Islamic greetings');
  if (/\b(bhai|vai|apni|apnar|apnake|kemon acho)\b/.test(t)) tags.push('formal Bangla (bhai/apni)');
  if (/\b(bro|dude|man|hey|yo|gonna|wanna|u r|ur|thx|ty)\b/.test(t)) tags.push('casual/short');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(String(text || ''))) tags.push('uses emoji');
  return tags.join(', ');
}

// ─── Core API ───

function isGloballyEnabled() {
  return load().globalEnabled !== false;
}

function setGlobalEnabled(bool) {
  load().globalEnabled = !!bool;
  scheduleSave();
}

function setUserEnabled(key, bool) {
  const p = getOrCreateProfile(key);
  p.memoryEnabled = !!bool;
  scheduleSave();
}

function listProfiles() {
  return Object.values(load().users).map(p => ({
    key: p.key,
    rawId: p.rawId,
    name: p.name || '',
    language: p.language || '',
    style: p.style || '',
    memoryEnabled: p.memoryEnabled !== false,
    totalMessages: (p.activity && p.activity.totalMessages) || 0,
    lastInteraction: p.lastInteraction,
    createdAt: p.createdAt,
    shortTermCount: (shortTerm.get(p.key) || []).length
  })).sort((a, b) => (b.lastInteraction || '').localeCompare(a.lastInteraction || ''));
}

function getProfileView(key) {
  const p = getProfile(key);
  if (!p) return null;
  return {
    ...p,
    shortTerm: shortTerm.get(key) || []
  };
}

function updateProfile(key, patch) {
  const p = getOrCreateProfile(key);
  if (patch === null || typeof patch !== 'object') return p;
  if (typeof patch.name === 'string') p.name = truncate(patch.name, 60);
  if (typeof patch.language === 'string') p.language = truncate(patch.language, 20);
  if (typeof patch.style === 'string') p.style = truncate(patch.style, 120);
  if (typeof patch.notes === 'string') p.notes = truncate(patch.notes, 500);
  for (const field of ['interests', 'facts', 'preferences']) {
    if (Array.isArray(patch[field])) {
      p[field] = patch[field].map(x => truncate(String(x), ITEM_MAX_LEN)).filter(Boolean).slice(0, LIST_CAP);
    }
  }
  if (typeof patch.memoryEnabled === 'boolean') p.memoryEnabled = patch.memoryEnabled;
  if (patch.rawId) p.rawId = String(patch.rawId);
  scheduleSave();
  return p;
}

function deleteProfile(key) {
  const data = load();
  delete data.users[key];
  shortTerm.delete(key);
  scheduleSave();
  return true;
}

function clearShortTerm(key) {
  shortTerm.delete(key);
}

function addShortTerm(key, chatId, role, text) {
  if (isSensitive(text)) return; // privacy: skip sensitive raw messages
  let list = shortTerm.get(key);
  if (!list) { list = []; shortTerm.set(key, list); }
  list.push({ chatId, role, text: truncate(text, 160), time: nowIso() });
  if (list.length > SHORT_TERM_MAX) list.shift();
}

/**
 * Build a compact memory context prompt for the AI.
 * Long-term profile info + at most 3 recent messages from OTHER chats
 * (so it never duplicates the current chat history — saves tokens).
 */
function buildContext(key, currentChatId) {
  if (!key) return '';
  const data = load();
  if (data.globalEnabled === false) return '';
  const p = data.users[key];
  if (!p || p.memoryEnabled === false) return '';

  const lines = [];
  if (p.name) lines.push(`Name: ${truncate(p.name, 40)}`);
  if (p.language) {
    const langLabel = p.language === 'bn' ? 'Bangla' : p.language === 'ar' ? 'Arabic' : 'English';
    lines.push(`Language: ${langLabel}`);
  }
  if (p.style) lines.push(`Communication style: ${truncate(p.style, 70)}`);
  if (p.interests.length) lines.push(`Interests: ${p.interests.slice(0, 5).join(', ')}`);
  if (p.preferences.length) lines.push(`Preferences: ${p.preferences.slice(0, 5).join('; ')}`);
  if (p.facts.length) lines.push(`Known facts: ${p.facts.slice(0, 5).join('; ')}`);
  if (p.notes) lines.push(`Note: ${truncate(p.notes, 120)}`);

  // Recent context from OTHER chats only (cross-chat memory, no duplication)
  const other = (shortTerm.get(key) || []).filter(m => m.chatId && m.chatId !== currentChatId).slice(-3);
  if (other.length) {
    lines.push('Recent (other chats): ' + other.map(m => `${m.role === 'user' ? 'U' : 'A'}: ${truncate(m.text, 50)}`).join(' | '));
  }

  if (lines.length === 0) return '';
  return '--- USER MEMORY (from previous conversations; use it to personalize, but do not mention it explicitly) ---\n' +
    lines.join('\n').slice(0, CONTEXT_MAX_CHARS);
}

/**
 * Called after an AI reply. Updates activity patterns, language, style and
 * long-term memory — ONLY when useful info is detected (token-free heuristics).
 */
function updateFromExchange(key, rawId, userMsg, aiResponse, meta = {}) {
  try {
    const data = load();
    if (data.globalEnabled === false) return;
    if (!key || isSensitive(userMsg)) return;

    // Per-user disable must stop ALL storage (activity, short-term, facts).
    const existing = getProfile(key);
    if (existing && existing.memoryEnabled === false) return;
    const p = existing || createProfile(key, rawId);

    // Short-term (recent context) — cross-chat aware
    if (meta.chatId) addShortTerm(key, meta.chatId, 'user', userMsg);
    if (aiResponse && meta.chatId) addShortTerm(key, meta.chatId, 'assistant', aiResponse);

    // Activity patterns
    p.lastInteraction = nowIso();
    const a = p.activity;
    a.totalMessages = (a.totalMessages || 0) + 1;
    if (!a.firstSeen) a.firstSeen = nowIso();
    a.lastSeen = nowIso();
    const hour = new Date().getHours();
    a.activeHours[hour] = (a.activeHours[hour] || 0) + 1;
    if (meta.chatId) {
      a.chats[meta.chatId] = (a.chats[meta.chatId] || 0) + 1;
      const keys = Object.keys(a.chats);
      if (keys.length > ACTIVITY_CHAT_CAP) delete a.chats[keys[0]];
    }

    // Heuristic extraction (only meaningful fields). Language: Bangla is a
    // strong identity signal — once detected it sticks; otherwise we fill in
    // English/etc. only when nothing is known yet.
    const lang = detectLanguage(userMsg);
    if (lang && (!p.language || lang === 'bn')) p.language = lang;

    const name = extractName(userMsg);
    if (name) p.name = name;

    const style = detectStyle(userMsg);
    if (style && !p.style.includes(style.split(',')[0])) {
      p.style = p.style ? p.style + '; ' + style : style;
      p.style = truncate(p.style, 120);
    }

    for (const item of extractInterests(userMsg)) addUnique(p.interests, item);
    for (const item of extractPreferences(userMsg)) addUnique(p.preferences, item);
    for (const item of extractFacts(userMsg)) addUnique(p.facts, item);

    scheduleSave();
  } catch (e) {
    console.error('❌ Memory update failed:', e.message);
  }
}

/**
 * Maintenance: drop short-term of inactive users and remove long-term
 * profiles that have been silent for INACTIVE_PRUNE_DAYS.
 */
function prune() {
  try {
    const data = load();
    const cutoff = Date.now() - INACTIVE_PRUNE_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [key, p] of Object.entries(data.users)) {
      const last = p.lastInteraction ? new Date(p.lastInteraction).getTime() : 0;
      if (last && last < cutoff) {
        delete data.users[key];
        shortTerm.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      scheduleSave();
      console.log(`🧠 Memory prune: removed ${removed} inactive profile(s)`);
    }
  } catch (e) {}
}

module.exports = {
  getUserKey,
  isGloballyEnabled,
  setGlobalEnabled,
  getProfile,
  getOrCreateProfile,
  listProfiles,
  getProfileView,
  updateProfile,
  deleteProfile,
  setUserEnabled,
  clearShortTerm,
  buildContext,
  updateFromExchange,
  prune,
  isSensitive,
  LIMITS: { SHORT_TERM_MAX, CONTEXT_MAX_CHARS, LIST_CAP }
};
