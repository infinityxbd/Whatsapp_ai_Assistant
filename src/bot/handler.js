/**
 * Message Handler — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const aiService = require('../ai/service');
const { readJSON } = require('../storage/store');
const { handleCommand } = require('./commands');
const memoryService = require('../memory/service');

const MAX_HISTORY = 10;
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

// Rich context payload for the hybrid AI decision tier (unclear messages).
// Includes sender identity, group + bot IDs, bot names/aliases, group
// participants, reply metadata, the quoted message, and the recent messages.
async function buildGroupDecisionContext(message, client, botState, config, chatId, signals, history) {
  const ctx = {
    body: message.body || '',
    senderId: (message.author || message.from) || '',
    groupId: chatId,
    botWid: (botState && botState.botWid) || '',
    botName: String((config && config.botName) || '').trim() || 'AI Assistant',
    botNames: [],
    isReplyToBot: !!(signals && signals.isReplyToBot),
    continuation: !!(signals && signals.continuation),
    participantNames: [],
    quotedText: '',
    quotedAuthor: '',
    history: Array.isArray(history) ? history : []
  };
  try { ctx.botNames = require('./group-intel').getBotNames(config); } catch (e) {}
  try {
    ctx.participantNames = await require('./group-intel').getGroupParticipantNames(client, chatId);
  } catch (e) {}
  try {
    const contact = await message.getContact();
    ctx.senderName = (contact && (contact.pushname || contact.name)) || '';
  } catch (e) {}
  try {
    const hasQuoted = typeof message.hasQuotedMsg === 'function' ? await message.hasQuotedMsg() : !!message.hasQuotedMsg;
    if (hasQuoted) {
      const q = await message.getQuotedMessage();
      ctx.quotedText = (q && q.body) || '';
      if (q) {
        try {
          const qc = await q.getContact();
          ctx.quotedAuthor = (qc && (qc.pushname || qc.name)) || q.author || '';
        } catch (e) { ctx.quotedAuthor = q.author || ''; }
      }
    }
  } catch (e) {}
  return ctx;
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
    // NOTE: blocked/muted/archived messages are NORMAL messages, not unsent
    // ones. They are logged here for the owner but NEVER written to /unsent
    // (only genuine WhatsApp revoke events are recorded there).
    const chatCheck = await checkMutedArchived(message.from, client);
    if (chatCheck) {
      console.log(`🔇 Skipping ${chatCheck} chat: ${message.from} — normal message, NOT counted as unsent`);
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
        console.log(`⛔ Blocked sender message ignored — normal message, NOT counted as unsent`);
        return;
      }
      if (isGroup && blocklist.groups.some(g => cleanId(g) === cleanId(message.from))) {
        console.log(`⛔ Blocked group message ignored — normal message, NOT counted as unsent`);
        return;
      }
      if (config.botEnabled === false) return;

      const chatId = message.from;
      const userMsg = message.body;

      console.log(`💬 [${formatTime()}] ${isGroup ? 'Group' : 'Inbox'}: ${chatId}`);
      console.log(`📨 "${userMsg}"`);

      // ─── User Memory System: identify user + build compact context ───
      // Same user is remembered across inbox, groups and mentions because the
      // memory key is the sender's phone (LID gets resolved to the real number).
      const rawSender = isGroup ? (message.author || message.from) : message.from;
      let userKey = memoryService.getUserKey(rawSender);
      try {
        if (String(rawSender).endsWith('@lid')) {
          const { resolveLid } = require('./whatsapp');
          const resolved = await resolveLid(rawSender);
          if (resolved) userKey = memoryService.getUserKey(resolved);
        }
      } catch (e) {}
      const memoryContext = memoryService.buildContext(userKey, chatId);

      if (isGroup) {
        // ─── Group Conversation Intelligence (Hybrid AI decision flow) ───
        // Every message is classified first (reply-to-bot, bot name/mention,
        // self-correction, open group question, specific participant, or
        // unclear) and the bot then decides whether to reply, react, or stay
        // silent — like a natural group member. AI calls are reserved for:
        //   1. direct bot interaction  → full AI reply, always
        //   2. open group questions    → AI reply, by chance
        //   4. unclear messages        → AI decision with full context
        // Human-to-human messages are never sent to the AI (token saving).
        const gIntel = require('./group-intel');
        const ctxLimit = Math.min(Math.max(parseInt(config.contextMessageLimit) || 5, 3), 10);
        const logMsgId = message.id._serialized || message.id.id || message.id;
        const logSender = isGroup ? (message.author || message.from) : message.from;

        // Group whitelist: when set, the bot only participates in these groups
        if (!gIntel.isGroupWhitelisted(message.from, config)) {
          console.log(`⏭️ Group not in whitelist: ${chatId}`);
          gIntel.logGroupDecision(config, { msgId: logMsgId, groupId: chatId, senderId: logSender, type: 'ignored', target: 'unknown', intent: '', confidence: 0, replyStatus: 'not_whitelisted', message: userMsg });
          return;
        }

        // Reaction chance (0 = disabled, null/undefined = default 0.12)
        const reactionChance = (() => {
          const rc = parseFloat(config.reactionChance);
          return isNaN(rc) ? 0.12 : Math.min(Math.max(rc, 0), 1);
        })();

        addToHistory(chatId, 'user', userMsg);

        // Message target classification (uses quoted-message metadata, sender
        // + bot IDs, bot aliases, participant names and recent history).
        // NOTE: the current message was already added to history above, so we
        // pass history minus the last entry — "recent context" means what the
        // bot said BEFORE this message, never the message itself.
        const signals = await gIntel.classifyGroupMessage(message, client, botState, config, {
          history: getChatHistory(chatId).slice(0, -1)
        });

        // Remember identity corrections ("Ami Nahid na" → fact: user is not
        // the bot) so later conversations don't mix up who is who.
        if (signals.isSelfCorrection) {
          console.log(`👤 Self-reference identity message (always addressed): "${userMsg}"`);
          const botName = String((config && config.botName) || '').trim() || 'the bot';
          memoryService.addFact(userKey, `Identity: user is not ${botName} (first-person clarification)`, rawSender);
        }

        // ─── Emoji-only reactions ───
        // Simple reactions normally get an emoji reaction back, not a full
        // reply (avoids spam). A reaction attached to the bot's OWN message —
        // or directly following the bot's last message — may still deserve a
        // short reply when enabled in the admin panel.
        let reacted = false;
        let forceReply = false;
        if (signals.isReaction) {
          if ((config.reactionsEnabled !== false) && Math.random() < reactionChance) {
            try { await message.react(gIntel.pickReactionEmoji(userMsg)); } catch (e) {}
            reacted = true;
          }
          let reactReply = (signals.isReplyToBot || signals.continuation) && config.replyToReactions;
          if (reactReply) {
            let rr = parseFloat(config.reactionReplyChance);
            if (isNaN(rr)) rr = 0.2;
            if (/[?？]|🤔|🤨|❓/.test(userMsg)) rr = Math.max(rr, 0.5); // question-like reaction → more likely to answer
            if (Math.random() < rr) forceReply = true;
          }
          if (!forceReply) {
            memoryService.updateFromExchange(userKey, rawSender, userMsg, null, { chatId, isGroup });
            return;
          }
          // fall through → send a short natural reply to the reaction
        }

        // ─── Hybrid AI decision flow ───
        //   direct_ai        → bot-interaction: always reply (name / @mention /
        //                      reply-to / correction / forced reaction reply)
        //   open_question_ai → group-wide question/chat: QUESTIONS always
        //                      reply, casual chatter joins by chance
        //   context_ai       → unclear message: main AI decides with context
        //   ignored          → specific_user / filler / AI intelligence off
        const groupAiOn = config.groupAiEnabled !== false;
        let doReply = false;
        let processingType = 'ignored';
        let aiDecision = null;
        let aiReplyOverride = ''; // token-saver: the decision engine's draft reply

        if (forceReply) {
          processingType = 'direct_ai';
          doReply = true;
        } else if (signals.target === 'bot') {
          processingType = 'direct_ai';
          doReply = true;
        } else if (groupAiOn && signals.target === 'group') {
          processingType = 'open_question_ai';
          // Open group QUESTIONS always get a reply: the bot is a group member
          // and the question invites anyone to answer ("Keo aso?", "Sobai kemon
          // aso?", "Keu jane?"). This bypasses the random-chance gate and the
          // cooldown — the per-minute rate limit and duplicate suppression
          // below still apply. Non-question group chatter stays chance-based.
          doReply = !gIntel.isLowContent(userMsg) && (signals.intent === 'open_question' || gIntel.shouldRandomReply(chatId, config, userMsg));
        } else if (signals.target === 'specific_user') {
          processingType = 'ignored'; // private conversation between members
          doReply = false;
        } else if (groupAiOn) {
          // Tier 4: unclear message → ask the main AI (with full context) to
          // decide. Anti-spam gates run BEFORE the AI call to save tokens.
          // A genuine continuation of the bot's own last message ("kemon?") is
          // allowed through the cooldown so natural back-and-forth survives;
          // the per-minute rate limit still acts as the anti-spam backstop.
          processingType = 'context_ai';
          if (gIntel.isLowContent(userMsg)) {
            doReply = false;
          } else if (!gIntel.withinReplyRate(chatId, config.maxRepliesPerMinute)) {
            doReply = false;
          } else if (!signals.continuation && gIntel.withinCooldown(chatId, config.groupCooldownSec)) {
            doReply = false;
          } else {
            const decisionCtx = await buildGroupDecisionContext(message, client, botState, config, chatId, signals, getChatHistory(chatId).slice(-(ctxLimit + 1), -1));
            aiDecision = await aiService.classifyGroupMessage(decisionCtx);
            // Token-safety: a "shouldReply" without an actual draft reply is
            // treated as "no reply" — one AI call per unclear message, never two.
            const decisionOk = aiDecision.shouldReply === true && String(aiDecision.reply || '').trim().length > 0;
            doReply = decisionOk;
            if (decisionOk) aiReplyOverride = aiDecision.reply;
          }
        } else {
          // AI intelligence off → mention/direct-only behavior
          processingType = 'ignored';
          doReply = false;
        }

        // Reaction replies are bot-directed by definition (log consistency)
        const logTarget = forceReply ? 'bot' : signals.target;

        if (!doReply) {
          gIntel.logGroupDecision(config, {
            msgId: logMsgId, groupId: chatId, senderId: logSender, type: processingType,
            target: logTarget, intent: signals.intent, confidence: aiDecision ? aiDecision.confidence : signals.confidence,
            aiDecision, replyStatus: 'skipped', message: userMsg
          });
          if (!reacted && (config.reactionsEnabled !== false) && Math.random() < reactionChance) {
            try { await message.react(gIntel.pickReactionEmoji(userMsg)); } catch (e) {}
          }
          memoryService.updateFromExchange(userKey, rawSender, userMsg, null, { chatId, isGroup });
          return;
        }

        // ─── Anti-spam: per-group rate limit (direct interactions bypass the
        // cooldown but still respect the per-minute cap) ───
        if (!gIntel.withinReplyRate(chatId, config.maxRepliesPerMinute)) {
          gIntel.logGroupDecision(config, {
            msgId: logMsgId, groupId: chatId, senderId: logSender, type: processingType,
            target: logTarget, intent: signals.intent, confidence: aiDecision ? aiDecision.confidence : signals.confidence,
            aiDecision, replyStatus: 'rate_limited', message: userMsg
          });
          memoryService.updateFromExchange(userKey, rawSender, userMsg, null, { chatId, isGroup });
          return;
        }
        gIntel.markReplied(chatId);
        gIntel.markReplyTime(chatId);
        const joinLabel = processingType === 'direct_ai'
          ? (signals.isReplyToBot || forceReply ? 'replied-to bot' : 'addressed')
          : (processingType === 'open_question_ai' ? 'open group message' : 'context_ai decision');
        console.log(`👥 Group reply (${joinLabel}): ${chatId}`);

        // Natural human pacing: read the message, then "type" the reply
        await sleep(gIntel.naturalDelay(userMsg, true));
        try { await client.sendSeen(chatId); } catch (e) {}
        try {
          await client.pupPage.evaluate((id) => {
            window.WWebJS.sendChatstate('typing', id);
            return true;
          }, chatId);
        } catch (e) {}
        await sleep(600 + Math.random() * 1200);

        const history = getChatHistory(chatId).slice(-ctxLimit);
        const groupSystemPrompt = gIntel.buildGroupPrompt(config);
        let aiResponse;
        if (aiReplyOverride) {
          aiResponse = aiReplyOverride; // token-efficient: decision engine already drafted it
        } else {
          aiResponse = await aiService.generateReply(userMsg, history, { memoryContext, systemPrompt: groupSystemPrompt });
        }
        aiResponse = gIntel.trimToNatural(aiResponse); // keep group replies short & human

        // ─── Anti-spam: duplicate reply prevention ───
        if (gIntel.isDuplicateReply(chatId, aiResponse, config.duplicateReplySec)) {
          gIntel.logGroupDecision(config, {
            msgId: logMsgId, groupId: chatId, senderId: logSender, type: processingType,
            target: logTarget, intent: signals.intent, confidence: aiDecision ? aiDecision.confidence : signals.confidence,
            aiDecision, replyStatus: 'duplicate_suppressed', message: userMsg
          });
          memoryService.updateFromExchange(userKey, rawSender, userMsg, null, { chatId, isGroup });
          return;
        }
        gIntel.rememberReply(chatId, aiResponse);

        console.log(`🤖 Reply: "${aiResponse}"`);
        addToHistory(chatId, 'model', aiResponse);
        memoryService.updateFromExchange(userKey, rawSender, userMsg, aiResponse, { chatId, isGroup });
        try {
          await client.pupPage.evaluate((id) => {
            window.WWebJS.sendChatstate('stop', id);
            return true;
          }, chatId);
        } catch (e) {}
        await sendMessage(chatId, aiResponse, message, client);
        console.log(`✅ Sent to ${chatId}`);
        gIntel.logGroupDecision(config, {
          msgId: logMsgId, groupId: chatId, senderId: logSender, type: processingType,
          target: logTarget, intent: signals.intent, confidence: aiDecision ? aiDecision.confidence : signals.confidence,
          aiDecision, replyStatus: 'replied', message: userMsg
        });
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
        const aiResponse = await aiService.generateReply(userMsg, history, { memoryContext });
        console.log(`🤖 Reply: "${aiResponse}"`);
        addToHistory(chatId, 'model', aiResponse);
        memoryService.updateFromExchange(userKey, rawSender, userMsg, aiResponse, { chatId, isGroup });
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
