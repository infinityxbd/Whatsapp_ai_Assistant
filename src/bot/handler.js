/**
 * Message Handler — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const aiService = require('../ai/service');
const { readJSON } = require('../storage/store');
const { handleCommand } = require('./commands');
const { saveUnsent } = require('./unsent');

const MAX_HISTORY = 7;
const chatHistories = {};
const MAX_CONCURRENT = 3;
let activeCount = 0;
const processedMessages = new Set();
const MAX_PROCESSED_CACHE = 5000;

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Dhaka' });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1) * 1000) + min * 1000;
}

// Flood protection: limit concurrent message processing
async function queueMessage(fn) {
  while (activeCount >= MAX_CONCURRENT) {
    await sleep(500);
  }
  activeCount++;
  try {
    await fn();
  } finally {
    activeCount--;
  }
}

function isMessageProcessed(msgId) {
  return processedMessages.has(msgId);
}

function markMessageProcessed(msgId) {
  processedMessages.add(msgId);
  if (processedMessages.size > MAX_PROCESSED_CACHE) {
    const first = processedMessages.values().next().value;
    processedMessages.delete(first);
  }
}

function cleanId(id) {
  return String(id).replace(/@c\.us/, '').replace(/@lid/, '').replace(/@g\.us/, '');
}

// Digest-only blocked-number match, tolerating country-code / leading-zero
// differences (e.g. blocked as `017XXXXXXXX` but WID is `88017XXXXXXXX`).
// Suffix match is limited to at most 3 extra leading digits.
function isBlockedNumberDigits(digits) {
  if (!digits || digits.length < 7) return false;
  const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
  for (const n of blocklist.numbers) {
    const bDigits = String(n || '').replace(/\D/g, '');
    if (!bDigits || bDigits.length < 7) continue;
    if (digits === bDigits) return true;
    // Tolerate up to 3 extra leading digits (country code / leading zero)
    const longer = digits.length >= bDigits.length ? digits : bDigits;
    const shorter = digits.length >= bDigits.length ? bDigits : digits;
    if (longer.length - shorter.length <= 3 && longer.endsWith(shorter)) return true;
  }
  return false;
}

// Robust block check: exact clean-id match, plus digit match, plus resolution
// of the contact's real phone number (WhatsApp Web may use LIDs that don't
// match the blocked phone number).
async function isBlocked(message, client) {
  const number = message.from;
  if (!number) return false;

  if (isBlockedNumberDigits(String(number).replace(/\D/g, ''))) return true;

  // Resolve the contact's real number (handles LID → phone)
  let phoneDigits = null;
  try {
    const { resolveLid } = require('./whatsapp');
    const resolved = await resolveLid(number);
    phoneDigits = resolved ? String(resolved).replace(/\D/g, '') : null;
  } catch (e) {}

  if (phoneDigits && isBlockedNumberDigits(phoneDigits)) return true;

  // Fallback via message.getContact()
  if (!phoneDigits) {
    try {
      const contact = await message.getContact();
      if (contact && contact.number) {
        phoneDigits = String(contact.number).replace(/\D/g, '');
        if (phoneDigits && isBlockedNumberDigits(phoneDigits)) return true;
      }
    } catch (e) {}
  }

  return false;
}

// Persist a message that will NOT get an AI reply (blocked sender, blocked
// group, or muted/archived chat) into the rolling unsent buffer so the owner
// can review it via /unsent. Both inbox (private) and group messages are kept.
async function saveUnsentMessage(message, isGroup) {
  let name = '';
  try { name = (await message.getChat()).name || ''; } catch (e) {}
  try {
    saveUnsent({
      msgId: (message.id && (message.id._serialized || message.id.id)) || '',
      from: message.from,
      name,
      time: new Date().toISOString(),
      body: message.body || '',
      type: isGroup ? 'group' : 'inbox'
    });
  } catch (e) {
    console.error('❌ saveUnsent failed:', e.message);
  }
}

function isEmojiOnly(text) {
  const stripped = text.trim();
  // Remove all known emoji ranges and check if anything remains
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}]/gu;
  const withoutEmoji = stripped.replace(emojiRegex, '').replace(/\s/g, '');
  return withoutEmoji.length === 0;
}

function getChatHistory(chatId) {
  if (!chatHistories[chatId]) chatHistories[chatId] = [];
  return chatHistories[chatId];
}

function addToHistory(chatId, role, text) {
  const history = getChatHistory(chatId);
  history.push({ role, text });
  while (history.length > MAX_HISTORY) history.shift();
}

async function sendMessage(chatId, text, message, client) {
  const msgId = message.id._serialized || message.id.id || message.id;

  // Method 1: client.sendMessage with quotedMessageId (library's built-in, most reliable)
  try {
    await client.sendMessage(chatId, text, { quotedMessageId: msgId });
    return true;
  } catch (e1) {
    console.log(`⚠️ Quote method 1 (sendMessage quoted) failed: ${e1.message}`);
  }

  // Method 2: message.reply() fallback
  try {
    await message.reply(text);
    return true;
  } catch (e2) {
    console.log(`⚠️ Quote method 2 (message.reply) failed: ${e2.message}`);
  }

  // Method 3: chat.sendMessage with quotedMessageId
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendMessage(text, { quotedMessageId: msgId });
    return true;
  } catch (e3) {
    console.log(`⚠️ Quote method 3 (chat.sendMessage) failed: ${e3.message}`);
  }

  // Method 4: Plain message — no quoting, last resort
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendMessage(text);
    return true;
  } catch (e4) {
    console.error(`❌ All send methods failed: ${e4.message}`);
    return false;
  }
}

async function checkMutedArchived(chatId, client) {
  try {
    const chat = await client.getChatById(chatId);
    if (chat.isMuted) return 'muted';
    if (chat.archived) return 'archived';
    return null;
  } catch (e) {}
  try {
    const result = await client.pupPage.evaluate((id) => {
      try {
        const Chat = window.require('WAWebCollections').Chat;
        const model = Chat.getModelsArray().find(c => c.id && c.id._serialized === id);
        if (!model) return null;
        const isMuted = model.mute && model.mute.expiration !== 0;
        const isArchived = !!model.archive;
        if (isMuted) return 'muted';
        if (isArchived) return 'archived';
        return null;
      } catch (e) { return null; }
    }, chatId);
    return result;
  } catch (e) {}
  return null;
}

async function handleMessage(message, client) {
  try {
    if (message.type !== 'chat') return;

    const msgId = message.id._serialized || message.id.id || message.id;
    if (isMessageProcessed(msgId)) {
      console.log(`⏭️ Skipping duplicate message: ${msgId}`);
      return;
    }
    markMessageProcessed(msgId);

    const { botState } = require('./whatsapp');
    const isGroup = message.from.endsWith('@g.us');

    // ─── Self-sent messages: commands only, ignore everything else ───
    if (message.fromMe) {
      const body = (message.body || '').trim();
      if (body.startsWith('/')) {
        console.log(`📤 Self-command: "${body}" from own number`);
        const commandSenderId = message.from;
        const isCommand = await handleCommand(message, client, botState.botWid, botState.lidMap, commandSenderId);
        if (isCommand) {
          console.log(`✅ Self-command executed: ${body}`);
        }
      }
      // Ignore all other self-sent messages (no AI reply, no loop)
      return;
    }

    // ─── Incoming messages: muted/archived check ───
    const chatCheck = await checkMutedArchived(message.from, client);
    if (chatCheck) {
      console.log(`🔇 Skipping ${chatCheck} chat: ${message.from}`);
      await saveUnsentMessage(message, isGroup);
      return;
    }

    const commandSenderId = isGroup ? (message.author || message.from) : message.from;

    // Commands from other admins
    const isCommand = await handleCommand(message, client, botState.botWid, botState.lidMap, commandSenderId);
    if (isCommand) return;

    // Flood protection: queue AI reply processing
    await queueMessage(async () => {
      const config = readJSON('config.json') || {};
      const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };

      if (isGroup && !config.replyToGroups) return;
      if (!isGroup && !config.replyToInbox) return;

      if (blocklist.numbers.length > 0 && await isBlocked(message, client)) {
        await saveUnsentMessage(message, isGroup);
        return;
      }
      if (isGroup && blocklist.groups.some(g => cleanId(g) === cleanId(message.from))) {
        await saveUnsentMessage(message, isGroup);
        return;
      }
      if (config.botEnabled === false) return;

      const chatId = message.from;
      const userMsg = message.body;

       if (isGroup && isEmojiOnly(userMsg)) return;

      console.log(`💬 [${formatTime()}] ${isGroup ? 'Group' : 'Inbox'}: ${chatId}`);
      console.log(`📨 "${userMsg}"`);

      if (isGroup) {
        await sleep(1000 + Math.random() * 1000);
        try { await client.sendSeen(chatId); } catch (e) {}
        addToHistory(chatId, 'user', userMsg);
        const history = getChatHistory(chatId);
        const aiResponse = await aiService.generateReply(userMsg, history);
        console.log(`🤖 Reply: "${aiResponse}"`);
        addToHistory(chatId, 'model', aiResponse);
        await sendMessage(chatId, aiResponse, message, client);
        console.log(`✅ Sent to ${chatId}`);
      } else {
        await sleep(randomBetween(1, 3));
        try { await client.sendSeen(chatId); } catch (e) {}
        try {
          await client.pupPage.evaluate((id) => {
            window.WWebJS.sendChatstate('typing', id);
            return true;
          }, chatId);
        } catch (e) {}
        await sleep(randomBetween(5, 10));
        addToHistory(chatId, 'user', userMsg);
        const history = getChatHistory(chatId);
        const aiResponse = await aiService.generateReply(userMsg, history);
        console.log(`🤖 Reply: "${aiResponse}"`);
        addToHistory(chatId, 'model', aiResponse);
        try {
          await client.pupPage.evaluate((id) => {
            window.WWebJS.sendChatstate('stop', id);
            return true;
          }, chatId);
        } catch (e) {}
        await sendMessage(chatId, aiResponse, message, client);
        console.log(`✅ Sent to ${chatId}`);
      }

      try { await client.sendPresenceAvailable(); } catch (e) {}
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

module.exports = { handleMessage };
