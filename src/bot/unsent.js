/**
 * Unsent Messages Store — infinityX Bot
 * Keeps a rolling buffer of messages the bot did NOT reply to
 * (blocked senders, bot OFF, inbox/group reply disabled).
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
  list.push(entry);
  const trimmed = list.slice(-UNSENT_LIMIT);
  writeJSON(FILE, trimmed);
  return trimmed;
}

function listUnsent() {
  return load();
}

function clearUnsent() {
  writeJSON(FILE, []);
}

module.exports = { saveUnsent, listUnsent, clearUnsent, UNSENT_LIMIT };
