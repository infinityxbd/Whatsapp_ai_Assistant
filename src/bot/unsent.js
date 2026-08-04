/**
 * Unsent Messages Store — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 *
 * Stores ONLY messages that were ACTUALLY deleted/unsent in WhatsApp
 * (real "Delete for everyone" / message_revoke_everyone events).
 *
 * Normal messages — whether replied to, blocked, muted, archived or edited —
 * are NEVER stored here. A record is only created when the WhatsApp library
 * emits a genuine revocation event for a message ID.
 *
 * Unique constraint: one record per WhatsApp message ID (msgId). If the same
 * revoke event arrives twice, the duplicate is ignored.
 */

const { readJSON, writeJSON } = require('../storage/store');

const UNSENT_LIMIT = 30;
const FILE = 'unsent.json';
const STATUS_UNSENT = 'UNSENT';

// Only keep genuine UNSENT records. The old buggy version also stored
// blocked/muted/archived NORMAL messages (without a status field) here — this
// migration drops them so they can never show up in /unsent again.
function load() {
  const data = readJSON(FILE);
  if (!Array.isArray(data)) return [];
  return data.filter(u => u && u.status === STATUS_UNSENT && u.msgId);
}

/**
 * Save a genuinely-unsent message. Returns { added: true, record } on success
 * or { added: false, duplicate: true } when a record with the same msgId
 * already exists (unique constraint — duplicates are never created).
 */
function saveUnsent(entry) {
  const list = load();
  const msgId = entry.msgId || '';
  if (msgId) {
    const idx = list.findIndex(u => u.msgId === msgId);
    if (idx !== -1) return { added: false, duplicate: true };
  }

  const chatId = entry.chatId || entry.from || '';
  const record = {
    msgId,
    chatId,
    type: entry.type || (String(chatId).includes('@g.us') ? 'group' : 'inbox'),
    sender: entry.sender || entry.author || entry.from || '',
    senderName: entry.senderName || entry.name || '',
    // chat display name (group name) for friendlier /unsent output
    name: entry.name || '',
    body: entry.body || '',
    msgType: entry.msgType || 'chat',
    originalTs: entry.originalTs || entry.time || new Date().toISOString(),
    deletedTs: entry.deletedTs || new Date().toISOString(),
    status: STATUS_UNSENT
  };

  list.push(record);
  const trimmed = list.slice(-UNSENT_LIMIT);
  writeJSON(FILE, trimmed);
  return { added: true, record };
}

function listUnsent() {
  return load();
}

// Newest unsent first. type === 'all' returns both, newest first.
function listUnsentTyped(type, count) {
  const n = Math.min(Math.max(parseInt(count) || 10, 1), UNSENT_LIMIT);
  let list = load().sort((a, b) => String(b.deletedTs || '').localeCompare(String(a.deletedTs || '')));
  if (type === 'inbox') list = list.filter(u => u.type !== 'group');
  else if (type === 'group') list = list.filter(u => u.type === 'group');
  return list.slice(0, n);
}

// Count only genuine UNSENT records. 'inbox' → private chats, 'group' → groups.
function countUnsentTyped(type) {
  const list = load();
  const inbox = list.filter(u => u.type !== 'group').length;
  const group = list.filter(u => u.type === 'group').length;
  if (type === 'inbox') return { inbox };
  if (type === 'group') return { group };
  return { inbox, group };
}

function clearUnsent() {
  writeJSON(FILE, []);
}

// Clear only the unsent entries of the given type and return how many were
// removed. type === 'inbox' → private chats only, 'group' → groups only.
function clearUnsentTyped(type) {
  const list = load();
  const kept = type === 'group'
    ? list.filter(u => u.type !== 'group')
    : list.filter(u => u.type === 'group');
  writeJSON(FILE, kept);
  return list.length - kept.length;
}

module.exports = {
  saveUnsent,
  listUnsent,
  listUnsentTyped,
  countUnsentTyped,
  clearUnsent,
  clearUnsentTyped,
  UNSENT_LIMIT,
  STATUS_UNSENT
};
