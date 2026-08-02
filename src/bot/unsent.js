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
  list.push({
    from: entry.from,
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

function clearUnsent() {
  writeJSON(FILE, []);
}

module.exports = { saveUnsent, listUnsent, listUnsentTyped, clearUnsent, UNSENT_LIMIT };
