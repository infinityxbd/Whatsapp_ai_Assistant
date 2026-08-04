/**
 * Unsent Messages Store — infinityX Bot
 * Keeps a rolling buffer (max 30) of messages the bot did NOT reply to:
 *   - senders on the blocklist (number or group)
 *   - muted / archived chats
 * Both inbox (private) and group messages are kept. Reviewable via /unsent.
 */
const { readJSON, writeJSON } = require('../storage/store');

const UNSENT_LIMIT = 30;
const FILE = 'unsent.json';

function load() {
  const data = readJSON(FILE);
  if (Array.isArray(data)) return data;
  return [];
}

function saveUnsent(entry) {
  const list = load();
  const msgId = entry.msgId || '';
  // Dedup: if the same message (by WhatsApp msgId) is already stored — e.g. it
  // was saved as a blocked/muted message and later revoked — replace it once.
  if (msgId) {
    const idx = list.findIndex(u => u.msgId === msgId);
    if (idx !== -1) list.splice(idx, 1);
  }
  list.push({
    msgId,
    from: entry.from,
    author: entry.author || '',
    name: entry.name || '',
    time: entry.time || new Date().toISOString(),
    body: entry.body || '',
    type: entry.type || (String(entry.from || '').includes('@g.us') ? 'group' : 'inbox')
  });
  // Auto-clean: keep only the most recent UNSENT_LIMIT entries.
  const trimmed = list.slice(-UNSENT_LIMIT);
  writeJSON(FILE, trimmed);
  return trimmed;
}

function listUnsent() {
  return load();
}

// Return the last `count` (capped at UNSENT_LIMIT) entries of the given type.
// type === 'all' returns both grouped chronologically (newest last).
function listUnsentTyped(type, count) {
  const n = Math.min(Math.max(parseInt(count) || 10, 1), UNSENT_LIMIT);
  let list = load();
  if (type === 'inbox') list = list.filter(u => u.type !== 'group');
  else if (type === 'group') list = list.filter(u => u.type === 'group');
  return list.slice(-n);
}

// Return the total number of stored unsent entries for the given type.
// type === 'inbox' → private chats only, 'group' → groups, 'all' → both.
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

module.exports = { saveUnsent, listUnsent, listUnsentTyped, countUnsentTyped, clearUnsent, clearUnsentTyped, UNSENT_LIMIT };
