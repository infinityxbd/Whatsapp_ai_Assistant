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
const SHORT_TERM_MAX = 36;        // messages kept per user (in memory only)
const CONTEXT_MAX_CHARS = 1200;   // hard cap for the prompt sent to the AI
const LIST_CAP = 10;              // max items per interest/fact/preference list
const ITEM_MAX_LEN = 80;          // max chars per stored item
const ACTIVITY_CHAT_CAP = 30;     // max tracked chats in activity patterns
const INACTIVE_PRUNE_DAYS = 180;  // profiles inactive this long get removed
const MEMORY_ANALYZE_SAMPLE = 30; // max recent messages sent to the AI per analysis
const ANALYZE_DEFAULT_EVERY = 20; // run AI analysis after this many messages
const ANALYZE_INACTIVITY_MS = 60 * 60 * 1000; // treat a 1h+ gap as inactivity

// ─── In-memory state ───
let cache = null;                 // { globalEnabled, users: { key: profile } }
let shortTerm = new Map();        // key -> [{ chatId, role, text, time }]
let dirty = false;
let saveTimer = null;
const analyzing = new Set();      // keys currently being AI-analyzed (dedupe)

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
  // Restore the persisted short-term buffer so the AI memory analysis keeps
  // working across the hourly soft restarts (memory-only buffer was wiped
  // every restart, so the analysis never accumulated enough conversation to
  // extract interests/preferences/facts).
  if (data && data.shortTerm && typeof data.shortTerm === 'object') {
    shortTerm = new Map();
    for (const [k, list] of Object.entries(data.shortTerm)) {
      if (Array.isArray(list)) shortTerm.set(k, list.filter(m => m && typeof m === 'object').slice(-SHORT_TERM_MAX));
    }
  }
  return cache;
}

function persist() {
  const data = load();
  writeJSON(FILE, {
    globalEnabled: data.globalEnabled,
    users: data.users,
    // Recent messages are capped (36/user) and sensitive content is filtered
    // in addShortTerm, so persisting them is safe and small. /forgetme and
    // clear-short-term remove them immediately.
    shortTerm: Object.fromEntries(shortTerm)
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

// Fill in fields that older saved profiles may lack (created before the AI
// memory upgrade). Without this, legacy profiles crash on .length / totalMessages
// access inside buildContext / updateFromExchange — silently killing all memory.
function normalizeProfile(p) {
  if (!p || typeof p !== 'object') return p;
  p.habits = Array.isArray(p.habits) ? p.habits : [];
  p.interests = Array.isArray(p.interests) ? p.interests : [];
  p.preferences = Array.isArray(p.preferences) ? p.preferences : [];
  p.facts = Array.isArray(p.facts) ? p.facts : [];
  p.notes = typeof p.notes === 'string' ? p.notes : '';
  p.memoryEnabled = p.memoryEnabled !== false;
  // One-time repair: junk names stored by older bot versions (e.g. the old
  // "ki bolto" bug) are cleared immediately on load — no AI call needed, so
  // the fix applies even when no AI provider is configured.
  if (p.name && !isValidName(p.name)) {
    p.name = '';
    scheduleSave();
  }
  p.lastAnalyzedAt = p.lastAnalyzedAt || null;
  p.analyzedMessageCount = p.analyzedMessageCount || 0;
  p.messagesSinceAnalyze = p.messagesSinceAnalyze || 0;
  if (!p.activity || typeof p.activity !== 'object') {
    p.activity = { totalMessages: 0, firstSeen: null, lastSeen: null, activeHours: {}, chats: {} };
  }
  return p;
}

function getProfile(key) {
  if (!key) return null;
  return normalizeProfile(load().users[key] || null);
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
    habits: [],                  // communication habits (AI extraction)
    notes: '',                    // admin-editable notes
    memoryEnabled: true,
    createdAt: nowIso(),
    lastInteraction: null,
    lastAnalyzedAt: null,        // last AI memory analysis time
    analyzedMessageCount: 0,     // total messages analyzed so far
    messagesSinceAnalyze: 0,     // batching counter (next AI analysis trigger)
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
const STOP_NAMES = new Set(['ok', 'okay', 'fine', 'good', 'here', 'there', 'busy', 'sorry', 'sure', 'bhai', 'bro', 'friend', 'student', 'bhai', 'vai', 'dost', 'bondhu', 'kemon', 'thik', 'acha', 'later', 'soon', 'please', 'thanks', 'thank', 'maybe', 'wait', 'help', 'yes', 'no', 'na', 'ha']);

// Words/patterns that can never be part of a real name (questions, filler,
// Bangla question words) — prevents junk like "ki bolto" from being saved.
const NAME_BAD_RE = /\b(ki|keno|kothay|kon|kobe|kokhon|naki|kemon|kemon|bolto|bolbe|bole|bol|nam|amake|amar|amr|tumi|tomar|apni|apnar|acha|accha|thik|na|ha|ki korbi|ki koros)\b/i;

// A stored name must look like a name: letters/spaces/apostrophe/hyphen only,
// at most 3 words, no digits/punctuation, no question/filler words, and not a
// known generic term.
function isValidName(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2 || n.length > 40) return false;
  if (/[0-9!?.,;:()[\]{}@#%^&*+=/\\"]/.test(n)) return false;
  if (NAME_BAD_RE.test(n)) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length > 3) return false;
  if (!/[a-zA-Z\u0980-\u09FF]/.test(n)) return false;
  // STOP_NAMES must be checked PER WORD — a junk phrase like "call me later"
  // contains a stop word and must never be stored as a name.
  if (words.some(w => STOP_NAMES.has(w.toLowerCase()))) return false;
  return true;
}

// Bangla words typed in Latin script (Banglish). Expanded so common spoken
// forms ("Khaichis?", "korbi", "Ajke") are recognised.
const BANGLISH_WORDS = new Set([
  'ami', 'amra', 'amar', 'amr', 'amake', 'tumi', 'tumar', 'tomar', 'tomake',
  'apni', 'apnar', 'apnake', 'tara', 'kori', 'kore', 'korbo', 'korbi', 'koros',
  'korchis', 'korchish', 'korechhi', 'koreche', 'khela', 'khelbo', 'khelbi',
  'hobe', 'hoye', 'hoy', 'ache', 'ase', 'nai', 'chai', 'chay', 'cholo', 'chol',
  'jani', 'jana', 'janina', 'boli', 'bolo', 'bolte', 'bolis', 'bolchi',
  'bhalo', 'valo', 'kemon', 'khobor', 'kotha', 'kichu', 'sob', 'sokol',
  'jodi', 'tahole', 'tokhon', 'ekhon', 'pore', 'tarpor', 'kal', 'ajke', 'aj',
  'kalke', 'goto', 'pora', 'pori', 'poris', 'dekhi', 'dekho', 'dekh', 'dekha',
  'shuni', 'shona', 'shune', 'vai', 'bhai', 'dost', 'bondhu', 'koto', 'ki',
  'kemne', 'kobe', 'kokhon', 'kothay', 'kon', 'keno', 'kivabe', 'kire', 'na',
  'ha', 'hmm', 'thik', 'theek', 'accha', 'acha', 'bujhlam', 'bujhte',
  'dorkar', 'lagbe', 'lage', 'khoob', 'khub', 'besh', 'sundor', 'moja', 'maja',
  'hasir', 'mone', 'mane', 'ar', 'o', 'tobe', 'kintu', 'jokhon', 'jemon',
  'temon', 'shob', 'shobar', 'chhara', 'niye', 'diye', 'hole', 'hote', 'jete',
  'aite', 'dite', 'nile', 'rakhi', 'rakhbo', 'khaichi', 'khaichis', 'khaicho'
]);

// Strong Banglish verb endings ("khaichis", "dekhchhe") — only for longer
// tokens to avoid false positives on English words.
const BANGLISH_SUFFIX_RE = /(?:chis|chish|chhe|chhi|chilam|chilen|echhi|eche)$/i;

// Language codes: 'bn' = Bangla script, 'bl' = Banglish (Bangla in Latin
// script), 'en' = English, 'mixed' = clear mix, 'ar' = Arabic.
const LANG_LABELS = { bn: 'Bangla', bl: 'Banglish', en: 'English', mixed: 'Mixed', ar: 'Arabic' };

// Detect actual writing style, NOT just script: "Ki koros?" / "Khaichis?" /
// "Ajke ki korbi?" are Banglish even though the language is Bengali.
function detectLanguage(text) {
  const t = String(text || '');
  const hasBangla = BANGLA_RE.test(t);
  const hasLatin = /[a-zA-Z]/.test(t);
  if (hasBangla) return hasLatin ? 'mixed' : 'bn';
  const words = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(w => w.length > 0);
  const banglish = words.some(w => BANGLISH_WORDS.has(w)) ||
    words.some(w => w.length >= 5 && BANGLISH_SUFFIX_RE.test(w));
  if (banglish) return 'bl';
  if (hasLatin) return 'en';
  if (/[\u0600-\u06FF]/.test(t)) return 'ar';
  return '';
}

function extractName(text) {
  const t = String(text || '');
  let m = t.match(/\bmy name is ([a-zA-Z][a-zA-Z' -]{1,29})/i);
  if (m && isValidName(m[1])) return cleanPhrase(m[1]);
  m = t.match(/\b(?:i'?m|i am|call me) ([a-zA-Z][a-zA-Z' -]{1,29})/i);
  if (m && isValidName(m[1]) && !m[1].includes(' ')) return cleanPhrase(m[1]);
  // Bangla sentences often spell the name in Latin script: "amar nam Rahim"
  m = t.match(/(?:amar|amr) nam (?:holo |hoy )?([a-zA-Z][a-zA-Z' \-]{1,25})/i);
  if (m && isValidName(m[1])) return cleanPhrase(m[1]);
  m = t.match(/(?:amar|amr) nam (?:holo |hoy )?([\u0980-\u09FF][\u0980-\u09FF ]{1,20})/);
  if (m && isValidName(m[1])) return cleanPhrase(m[1]);
  m = t.match(/amake ([a-zA-Z][a-zA-Z ]{1,20}) bole dake/i);
  if (m && isValidName(m[1])) return cleanPhrase(m[1]);
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
  // Banglish with a verb in between: "ami game khelte bhalobashi",
  // "ami cricket khelte valo lage", "ami music shunte bhalobashi",
  // "ami movie dekhate valo lage", "ami pora pochondo".
  const bm = t.match(/(?:ami|amra|amar) ([a-z][a-z0-9' \-]{1,24}) (?:khelte|shunte|dekhate|porte|niye) (?:bhalobashi|valo lage|pochondo|moja pai|pagol)/i);
  if (bm) out.push(cleanPhrase(bm[1]));
  // Strip trailing verbs from captures ("cricket khelte" → "cricket") and
  // reject captures that start with filler/question words ("ar kichu",
  // "keno khelte", "kokhon khelte") so only clean interests are stored.
  const FILLER_START = /^(ar|o|tobe|kintu|jodi|je|jemon|ekhon|tokhon|sob|kono|keno|kokhon|kobe|kothay|kon|ki|naki)\b/i;
  return out
    .map(x => x.replace(/\s+(?:khelte|shunte|dekhate|porte|niye|korte|hote|kheli|pori)$/i, ''))
    .map(x => truncate(x.replace(/^(to|the|a|an)\s+/i, ''), 50))
    .filter(Boolean)
    .filter(x => !FILLER_START.test(x));
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

// Common transient locations that must never become permanent facts:
// "ami kaj theke ashi" (coming from work), "ami bus e thaki" (on the bus)
// are everyday casual phrases, not stable residence/origin info.
const TRANSIENT_PLACES = new Set([
  'kaj', 'office', 'school', 'college', 'versity', 'university', 'bazar',
  'market', 'bus', 'train', 'ghor', 'bari', 'akhane', 'ekhane', 'oikhane',
  'shop', 'class', 'work', 'job', 'hospital', 'bank', 'bondhu', 'friend'
]);

function isStablePlace(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return false;
  if (TRANSIENT_PLACES.has(w)) return false;
  if (/^(the|a|an|my|amar|amr)$/.test(w)) return false;
  return true;
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
  // Banglish facts: "ami Dhaka theke ashi" (origin), "ami Chittagong e thaki"
  // (residence), "amar boyos 21" (age). High-precision so facts fill in even
  // when no AI provider is configured — but only STABLE places are kept
  // ("ami kaj/office/bari theke ashi" is a transient "coming from", never a
  // permanent fact).
  m = t.match(/(?:ami|amra) ([a-z][a-z0-9' \-]{1,30}) theke (?:ashi|ase)/i);
  if (m && isStablePlace(m[1])) out.push('From ' + cleanPhrase(m[1]));
  m = t.match(/(?:ami|amra) ([a-z][a-z0-9' \-]{1,30}) e thaki/i);
  if (m && isStablePlace(m[1])) out.push('Lives in ' + cleanPhrase(m[1]));
  // Age ONLY from the explicit "amar boyos N" form. The "ami N bosor" form
  // is NOT used because it false-positives on duration phrases like
  // "ami 2 bosor dhore..." ("for 2 years") and "ami 5 bosor age" ("5 years
  // ago").
  m = t.match(/(?:amar|amr) (?:boyos|boshor|age) (\d{1,2})\b/i);
  if (m) out.push(m[1] + ' years old');
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
    lastAnalyzedAt: p.lastAnalyzedAt || null,
    analyzedMessageCount: p.analyzedMessageCount || 0,
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
  for (const field of ['interests', 'facts', 'preferences', 'habits']) {
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
  // getProfile normalizes legacy profiles (fills missing arrays/fields) so the
  // unguarded .length accesses below never throw on old saved data.
  const p = getProfile(key);
  if (!p || p.memoryEnabled === false) return '';

  const lines = [];
  if (p.name) lines.push(`Name: ${truncate(p.name, 40)}`);
  if (p.language) lines.push(`Language: ${LANG_LABELS[p.language] || p.language}`);
  if (p.style) lines.push(`Communication style: ${truncate(p.style, 70)}`);
  if (p.habits && p.habits.length) lines.push(`Habits: ${p.habits.slice(0, 5).join(', ')}`);
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

    // Heuristic extraction (only meaningful fields). Language is judged by a
    // MAJORITY vote over the user's recent messages (last 10 user messages +
    // this one) so a single Bangla-script message can't flip a Banglish
    // profile (or vice versa). Bangla-family ('bn'/'bl'/'mixed') is sticky
    // once detected; 'en'/'ar' only fill in when nothing is known yet.
    const langSamples = (shortTerm.get(key) || [])
      .filter(m => m.role === 'user').slice(-10).map(m => m.text);
    // The current message was ALREADY added to shortTerm above (when
    // meta.chatId is set) — only append it when it isn't there yet, so it is
    // never double-counted in the vote.
    if (langSamples[langSamples.length - 1] !== truncate(userMsg, 160)) {
      langSamples.push(userMsg);
    }
    const langCounts = {};
    for (const t of langSamples) {
      const l = detectLanguage(t);
      if (l) langCounts[l] = (langCounts[l] || 0) + 1;
    }
    let bestLang = '';
    let bestLangN = 0;
    for (const [l, n] of Object.entries(langCounts)) {
      if (n > bestLangN) { bestLang = l; bestLangN = n; }
    }
    if (bestLang) {
      if (!p.language) p.language = bestLang;
      else if (bestLang === 'bn' || bestLang === 'bl' || bestLang === 'mixed') p.language = bestLang;
    }

    const name = extractName(userMsg);
    if (name && isValidName(name)) p.name = name; // never store junk as a name

    const style = detectStyle(userMsg);
    if (style && !p.style.includes(style.split(',')[0])) {
      p.style = p.style ? p.style + '; ' + style : style;
      p.style = truncate(p.style, 120);
    }

    for (const item of extractInterests(userMsg)) addUnique(p.interests, item);
    for (const item of extractPreferences(userMsg)) addUnique(p.preferences, item);
    for (const item of extractFacts(userMsg)) addUnique(p.facts, item);

    // ─── Token-efficient AI memory analysis batching ───
    // Run the AI extraction after every N meaningful messages (default 20),
    // or right after an inactivity gap (new message arriving after 1h+ with
    // at least 3 new messages). Fire-and-forget — never blocks the reply.
    p.messagesSinceAnalyze = (p.messagesSinceAnalyze || 0) + 1;
    const cfg = readJSON('config.json') || {};
    const analyzeEnabled = cfg.memoryAnalyzeEnabled !== false;
    const every = Math.max(parseInt(cfg.memoryAnalyzeEvery) || ANALYZE_DEFAULT_EVERY, 5);
    const sinceLast = p.lastAnalyzedAt ? Date.now() - new Date(p.lastAnalyzedAt).getTime() : Infinity;
    // Inactivity only applies to an existing analyzed conversation going quiet;
    // brand-new users rely on the every-N counter alone (avoids double-fires).
    const inactivity = p.lastAnalyzedAt && sinceLast > ANALYZE_INACTIVITY_MS && p.messagesSinceAnalyze >= 3;
    if (analyzeEnabled && (p.messagesSinceAnalyze >= every || inactivity)) {
      p.messagesSinceAnalyze = 0;
      analyzeUserMemory(key).catch(() => {});
    }

    scheduleSave();
  } catch (e) {
    console.error('❌ Memory update failed:', e.message);
  }
}

/**
 * Add a single fact to a user's long-term memory (deduped + capped).
 * Used for explicit statements worth remembering — e.g. identity corrections
 * like "Ami Nahid na" ("I'm not Nahid") so the bot never mixes the user up
 * with itself in later conversations.
 */
function addFact(key, text, rawId) {
  try {
    const data = load();
    if (data.globalEnabled === false) return;
    if (!key || isSensitive(text)) return;
    const existing = getProfile(key);
    if (existing && existing.memoryEnabled === false) return;
    const p = existing || createProfile(key, rawId || '');
    addUnique(p.facts, truncate(text, ITEM_MAX_LEN));
    scheduleSave();
  } catch (e) {
    console.error('❌ Memory addFact failed:', e.message);
  }
}

// ─── AI memory extraction (structured long-term profile) ───

// Compact summary of the existing profile, sent alongside recent messages so
// the AI can MERGE (add new evidence) instead of guessing from scratch.
function buildMemorySummary(p) {
  if (!p) return '(none)';
  const lines = [];
  if (p.name) lines.push('Name: ' + p.name);
  if (p.language) lines.push('Language: ' + (LANG_LABELS[p.language] || p.language));
  if (p.style) lines.push('Style: ' + p.style);
  if (p.habits && p.habits.length) lines.push('Habits: ' + p.habits.slice(0, 5).join(', '));
  if (p.interests && p.interests.length) lines.push('Interests: ' + p.interests.slice(0, 5).join(', '));
  if (p.preferences && p.preferences.length) lines.push('Preferences: ' + p.preferences.slice(0, 5).join('; '));
  if (p.facts && p.facts.length) lines.push('Facts: ' + p.facts.slice(0, 5).join('; '));
  return lines.join('\n') || '(none)';
}

// Merge extracted memory into the profile: keep existing valid info, add new
// evidence, never overwrite blindly. Name only from a validated introduction.
function mergeMemory(p, ex) {
  if (!ex || typeof ex !== 'object') return p;
  if (typeof ex.name === 'string' && isValidName(ex.name)) p.name = truncate(ex.name, 60);
  const langCode = { bangla: 'bn', banglish: 'bl', english: 'en', mixed: 'mixed' }[String(ex.language || '').toLowerCase()];
  if (langCode) {
    // Never downgrade a Bangla-family profile ('bn'/'bl'/'mixed') to 'en'/'ar'
    // on a single extraction — Bangla identity is sticky, mirroring the
    // heuristic rule in updateFromExchange.
    const banglaFamily = langCode === 'bn' || langCode === 'bl' || langCode === 'mixed';
    const existingFamily = p.language === 'bn' || p.language === 'bl' || p.language === 'mixed';
    if (!p.language || banglaFamily || !existingFamily) p.language = langCode;
  }
  if (typeof ex.style === 'string' && ex.style.trim()) {
    const s = truncate(ex.style.trim(), 80);
    if (s && !p.style.includes(s)) p.style = p.style ? p.style + '; ' + s : s;
    p.style = truncate(p.style, 120); // keep bounded across analyses
  }
  for (const field of ['interests', 'preferences', 'facts', 'habits']) {
    if (Array.isArray(ex[field])) {
      // Legacy profiles may lack the newer fields (e.g. habits) — initialize.
      if (!Array.isArray(p[field])) p[field] = [];
      for (const item of ex[field]) addUnique(p[field], item);
    }
  }
  return p;
}

/**
 * Run the AI memory extraction for a user (triggered by batching or manually
 * from the admin panel). Sends only the recent messages + existing summary
 * (token-efficient), merges the result, and records analysis metadata.
 * Returns the updated profile, or null when there isn't enough conversation
 * or the AI is unavailable.
 */
async function analyzeUserMemory(key) {
  // One analysis at a time per user: a burst of messages can trigger several
  // concurrent fires, and each would re-read (and re-merge) the same buffer.
  if (analyzing.has(key)) return null;
  analyzing.add(key);
  try {
    const data = load();
    if (data.globalEnabled === false) return null;
    const p = getProfile(key);
    if (!p || p.memoryEnabled === false) return null;

    const recent = (shortTerm.get(key) || []).slice(-MEMORY_ANALYZE_SAMPLE);
    if (recent.length < 3) return null; // not enough conversation to analyze yet

    const aiService = require('../ai/service');
    // Repair any previously-stored junk name (e.g. the old "ki bolto" bug) —
    // invalid stored names are cleared so a valid one can take its place.
    if (p.name && !isValidName(p.name)) p.name = '';

    const result = await aiService.extractUserMemory({
      messages: recent.map(m => (m.role === 'user' ? 'User: ' : 'Bot: ') + truncate(m.text, 200)).join('\n'),
      existingSummary: buildMemorySummary(p)
    });
    if (!result) return null;

    mergeMemory(p, result);
    p.lastAnalyzedAt = nowIso();
    p.analyzedMessageCount = (p.analyzedMessageCount || 0) + recent.length;
    p.messagesSinceAnalyze = 0;
    scheduleSave();
    console.log(`🧠 Memory analyzed for ${key}: name="${p.name || '?'}" lang=${p.language || '?'} interests=${p.interests.length} prefs=${p.preferences.length} facts=${p.facts.length} habits=${p.habits.length}`);
    return p;
  } catch (e) {
    console.error('❌ Memory AI analysis failed:', e.message);
    return null;
  } finally {
    analyzing.delete(key);
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
  addFact,
  analyzeUserMemory,
  buildMemorySummary,
  mergeMemory,
  isValidName,
  detectLanguage,
  persist,
  prune,
  isSensitive,
  LIMITS: { SHORT_TERM_MAX, CONTEXT_MAX_CHARS, LIST_CAP }
};
