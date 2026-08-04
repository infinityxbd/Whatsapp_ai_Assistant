/**
 * Bot Commands — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { readJSON, writeJSON } = require('../storage/store');

function cleanId(id) {
  return String(id).replace(/@c\.us/, '').replace(/@lid/, '').replace(/@g\.us/, '');
}

function isAdminUser(senderId) {
  const adminUsers = readJSON('adminusers.json') || [];
  if (!Array.isArray(adminUsers)) {
    writeJSON('adminusers.json', []);
    return null;
  }
  const senderClean = cleanId(senderId);
  const senderDigits = senderId.replace(/\D/g, '');

  for (const u of adminUsers) {
    if (!u || !u.number) continue;
    // Exact clean match
    if (cleanId(u.number) === senderClean) return u;
    // LID match
    if (u.lid && cleanId(u.lid) === senderClean) return u;
    // Digit-only match (most reliable for LID vs phone)
    const adminDigits = u.number.replace(/\D/g, '');
    if (adminDigits && senderDigits && adminDigits === senderDigits) return u;
  }
  return null;
}

function setConfig(key, value) {
  const config = readJSON('config.json') || {};
  config[key] = value;
  writeJSON('config.json', config);
}

async function reply(message, text, client) {
  try {
    await message.reply(text);
  } catch (e) {
    try {
      const chat = await client.getChatById(message.from);
      await chat.sendMessage(text);
    } catch (e2) {
      console.error(`❌ Reply failed: ${e2.message}`);
    }
  }
}

// Show WHO sent an unsent message: the sender display name when available,
// otherwise the real phone number (LID IDs get resolved so they are
// recognizable).
async function resolveUnsentWho(u, lidMap) {
  // Group unsent — show the group, and who unsent it when known.
  if (u.type === 'group') {
    const group = u.name ? `👥 ${u.name}` : `👥 Group ${cleanId(u.chatId || u.from || '')}`;
    if (u.senderName) return `${group} — 🚫 unsent by ${u.senderName}`;
    const author = u.author || u.sender;
    if (author) {
      const a = cleanId(author);
      const aDigits = String(author || '').replace(/\D/g, '');
      let who = a;
      if (lidMap && lidMap[a]) who = lidMap[a];
      else if (lidMap && lidMap[aDigits] && lidMap[aDigits] !== a) who = lidMap[aDigits];
      return `${group} — 🚫 unsent by ${who}`;
    }
    return group;
  }

  if (u.senderName) return `👤 ${u.senderName}`;
  if (u.name) return `👤 ${u.name}`;

  const clean = cleanId(u.sender || u.from || '');
  const digits = String(u.sender || u.from || '').replace(/\D/g, '');

  // In-memory LID map first (fast)
  if (lidMap) {
    if (lidMap[clean]) return `👤 ${lidMap[clean]}`;
    if (lidMap[digits] && lidMap[digits] !== clean) return `👤 ${lidMap[digits]}`;
  }

  // Fallback: resolve LID → real phone via client
  try {
    const { resolveLid } = require('./whatsapp');
    const phone = await resolveLid(u.sender || u.from || '');
    if (phone) return `👤 ${phone}`;
  } catch (e) {}

  return clean ? `👤 ${clean}` : '👤 Unknown';
}

async function handleCommand(message, client, botWid, lidMap, commandSenderId) {
  const body = message.body.trim();
  if (!body.startsWith('/')) return false;

  const senderId = commandSenderId || message.from;
  console.log(`🔍 Command: "${body}" from ${senderId} (chat: ${message.from})`);

  // Shared memory language labels (bn=Bangla, bl=Banglish, mixed, en, ar)
  const MEM_LANG_LABELS = { bn: 'Bangla', bl: 'Banglish', en: 'English', mixed: 'Mixed', ar: 'Arabic' };
  const memLang = code => MEM_LANG_LABELS[code] || '—';

  // ─── Public memory commands — work for ANY user (privacy rights) ───
  const cmdLower = body.split(' ')[0].toLowerCase();
  if (cmdLower === '/mymemory' || cmdLower === '/forgetme') {
    const memoryService = require('../memory/service');
    let memKey = memoryService.getUserKey(senderId);
    if (String(senderId).endsWith('@lid')) {
      try {
        const { resolveLid } = require('./whatsapp');
        const resolved = await resolveLid(senderId);
        if (resolved) memKey = memoryService.getUserKey(resolved);
      } catch (e) {}
    }
    if (cmdLower === '/forgetme') {
      memoryService.deleteProfile(memKey);
      console.log(`🧠 Memory deleted on user request: ${senderId} → key ${memKey}`);
      await reply(message, '🗑️ *Tomar shob data delete kore deya hoise.*\n\nAmi tomar kono information ar rakhi na. Jodi abar kotha bolo, ami abar notun kore shikhbo. 😊', client);
      return true;
    }
    const profile = memoryService.getProfile(memKey);
    if (!profile) {
      await reply(message, '🧠 *Amar tomar kono memory nei.*\n\nKono kichu rakhi nai — shudhu kotha bole thaki. 😊', client);
      return true;
    }
    let txt = '🧠 *Tomar Memory (amar jana kotha):*\n\n';
    txt += `👤 Name: ${profile.name || '—'}\n`;
    txt += `🗣️ Language: ${memLang(profile.language)}\n`;
    txt += `💬 Style: ${profile.style || '—'}\n`;
    if ((profile.habits || []).length) txt += `🔄 Habits: ${profile.habits.join(', ')}\n`;
    if (profile.interests.length) txt += `⭐ Interests: ${profile.interests.join(', ')}\n`;
    if (profile.preferences.length) txt += `👍 Preferences: ${profile.preferences.join('; ')}\n`;
    if (profile.facts.length) txt += `📌 Facts: ${profile.facts.join('; ')}\n`;
    txt += `\n🗑️ *Shob muche dite:* /forgetme`;
    await reply(message, txt, client);
    return true;
  }

  // Step 1: Try to resolve sender LID → phone
  let resolvedPhone = null;
  const senderClean = cleanId(senderId);
  const senderDigits = senderId.replace(/\D/g, '');

  // Check LidMap cache
  if (lidMap && lidMap[senderClean]) {
    resolvedPhone = lidMap[senderClean];
    console.log(`🔍 LID cache: ${senderClean} → ${resolvedPhone}`);
  }

  // Try resolving via contact lookup
  if (!resolvedPhone) {
    try {
      const { resolveLid } = require('./whatsapp');
      resolvedPhone = await resolveLid(senderId);
      if (resolvedPhone) {
        console.log(`🔍 Resolved ${senderId} → ${resolvedPhone}`);
      }
    } catch (e) {}
  }

  // Step 2: Check authorization
  let authorized = false;
  let isOwner = false;

  // 2a. Owner check — match sender digits with botWid digits
  const botDigits = (botWid || '').replace(/\D/g, '');
  if (senderDigits && botDigits && senderDigits === botDigits) {
    authorized = true;
    isOwner = true;
    console.log(`🟢 Owner match (digits): ${senderDigits}`);
  }

  // 2b. Owner check via resolved phone
  if (!authorized && resolvedPhone) {
    const rpDigits = resolvedPhone.replace(/\D/g, '');
    if (rpDigits && botDigits && rpDigits === botDigits) {
      authorized = true;
      isOwner = true;
      console.log(`🟢 Owner match (resolved phone): ${resolvedPhone}`);
    }
  }

  // 2c. Admin check — try with original ID first, then resolved phone
  if (!authorized) {
    const admin = isAdminUser(senderId) || (resolvedPhone ? isAdminUser(resolvedPhone) : null);
    if (admin) {
      authorized = true;
      console.log(`👤 Admin match: ${admin.number} (${admin.name})`);
    }
  }

  // 2d. Direct LID map lookup: senderClean → phone → admin check
  if (!authorized && lidMap && lidMap[senderClean]) {
    const mappedPhone = lidMap[senderClean];
    const admin = isAdminUser(mappedPhone);
    if (admin) {
      authorized = true;
      console.log(`👤 Admin match via LID map: ${senderClean} → ${mappedPhone} (${admin.name})`);
    }
  }

  // 2e. Also try reverse lookup: if senderClean is a phone in the map, try it
  if (!authorized && lidMap) {
    for (const [key, val] of Object.entries(lidMap)) {
      if (val === senderClean && key !== senderClean) {
        const admin = isAdminUser(key);
        if (admin) {
          authorized = true;
          console.log(`👤 Admin match via reverse LID: ${senderClean} ← ${key} (${admin.name})`);
          break;
        }
      }
    }
  }

  if (!authorized) {
    console.log(`❌ Not authorized: ${senderId} (digits: ${senderDigits}, clean: ${senderClean}, resolved: ${resolvedPhone || 'null'}, botWid: ${botWid})`);
    await reply(message, '❌ You are not authorized to use commands.', client);
    return true;
  }

  if (isOwner) console.log(`🟢 Bot owner — full access`);
  else console.log(`👤 Admin access`);

  const args = body.split(' ');
  const cmd = args[0].toLowerCase();
  const param = args.slice(1).join(' ');
  console.log(`👤 Executing: ${cmd}`);

  switch (cmd) {

    // ─── Bot Power ───
    case '/onbot': {
      setConfig('botEnabled', true);
      try { await client.sendPresenceAvailable(); } catch (e) {}
      await reply(message, '✅ Bot ON', client);
      return true;
    }
    case '/offbot': {
      setConfig('botEnabled', false);
      try { await client.sendPresenceUnavailable(); } catch (e) {}
      await reply(message, '✅ Bot OFF', client);
      return true;
    }

    // ─── Inbox/Group Toggle ───
    case '/oninbox': {
      setConfig('replyToInbox', true);
      await reply(message, '✅ Inbox reply ON', client);
      return true;
    }
    case '/offinbox': {
      setConfig('replyToInbox', false);
      await reply(message, '✅ Inbox reply OFF', client);
      return true;
    }
    case '/ongroup': {
      setConfig('replyToGroups', true);
      await reply(message, '✅ Group reply ON', client);
      return true;
    }
    case '/offgroup': {
      setConfig('replyToGroups', false);
      await reply(message, '✅ Group reply OFF', client);
      return true;
    }

    // ─── Block ───
    case '/block': {
      if (!param) {
        await reply(message, '❌ Usage: /block <number>', client);
        return true;
      }
      let num = param.replace(/\D/g, '');
      if (!num.endsWith('@c.us')) num += '@c.us';
      const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
      if (blocklist.numbers.includes(num)) {
        await reply(message, `⚠️ ${param} already blocked.`, client);
        return true;
      }
      blocklist.numbers.push(num);
      writeJSON('blocklist.json', blocklist);
      await reply(message, `✅ Blocked: ${param}`, client);
      return true;
    }
    case '/unblock': {
      if (!param) {
        await reply(message, '❌ Usage: /unblock <number or group_id>', client);
        return true;
      }
      const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
      const target = param.trim();
      let idx = blocklist.numbers.findIndex(n =>
        n === target || n === target + '@c.us' || n.replace('@c.us', '') === target
      );
      if (idx !== -1) {
        blocklist.numbers.splice(idx, 1);
        writeJSON('blocklist.json', blocklist);
        await reply(message, `✅ Unblocked: ${target}`, client);
        return true;
      }
      idx = blocklist.groups.findIndex(g => g === target);
      if (idx !== -1) {
        blocklist.groups.splice(idx, 1);
        writeJSON('blocklist.json', blocklist);
        await reply(message, `✅ Group unblocked: ${target}`, client);
        return true;
      }
      await reply(message, `❌ Not found: ${target}`, client);
      return true;
    }
    case '/blocklist': {
      const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
      let txt = '📋 *Block List*\n\n';
      txt += `Numbers: ${blocklist.numbers.length > 0 ? blocklist.numbers.map(n => n.replace('@c.us', '')).join(', ') : 'none'}\n`;
      txt += `Groups: ${blocklist.groups.length > 0 ? blocklist.groups.join(', ') : 'none'}`;
      await reply(message, txt, client);
      return true;
    }

    // ─── Unsent Messages ───
    // Shows ONLY messages that were actually deleted/unsent in WhatsApp
    // (real "Delete for everyone" revoke events). Normal messages — replied,
    // blocked, muted or archived — are never recorded here. Buffer is capped
    // at 30 (auto-clean). Newest unsent first.
    //   /unsent            → last 10, both inbox + group
    //   /unsent <n>          → last n (max 30), both
    //   /unsentin [n]        → last n inbox (private) only
    //   /unsentgp [n]        → last n group only
    case '/unsent':
    case '/unsentin':
    case '/unsentgp': {
      const unsentMod = require('./unsent');
      const mode = cmd === '/unsentin' ? 'inbox'
        : cmd === '/unsentgp' ? 'group'
        : 'all';
      const requested = param ? parseInt(param) : 10;
      const n = Math.min(Math.max(requested || 10, 1), unsentMod.UNSENT_LIMIT);
      const counts = unsentMod.countUnsentTyped(mode);

      const fmt = async (arr) => {
        const out = [];
        for (let i = 0; i < arr.length; i++) {
          const u = arr[i];
          const sent = u.originalTs ? new Date(u.originalTs).toLocaleString() : '';
          const deleted = u.deletedTs ? new Date(u.deletedTs).toLocaleString() : '';
          const who = await resolveUnsentWho(u, lidMap);
          out.push(`${i + 1}. 🚫 ${who}\n   🕐 Sent: ${sent}\n   🗑️ Deleted: ${deleted}\n   💬 ${String(u.body || '').slice(0, 80)}`);
        }
        return out;
      };

      const shownNote = (total) => total > n ? ` (showing last ${n} of ${total})` : '';

      if (mode === 'inbox') {
        const total = counts.inbox;
        if (total) {
          const list = unsentMod.listUnsentTyped('inbox', n) || [];
          await reply(message, `📥 *Inbox unsent: ${total} total*${shownNote(total)}\n\n${(await fmt(list)).join('\n')}`, client);
        } else {
          await reply(message, '📥 Inbox unsent: 0 (none).', client);
        }
        return true;
      }
      if (mode === 'group') {
        const total = counts.group;
        if (total) {
          const list = unsentMod.listUnsentTyped('group', n) || [];
          await reply(message, `👥 *Group unsent: ${total} total*${shownNote(total)}\n\n${(await fmt(list)).join('\n')}`, client);
        } else {
          await reply(message, '👥 Group unsent: 0 (none).', client);
        }
        return true;
      }

      // mode === 'all' → show last n of each type with real totals
      const groupTotal = counts.group;
      if (groupTotal) {
        const list = unsentMod.listUnsentTyped('group', n) || [];
        await reply(message, `👥 *Group unsent: ${groupTotal} total*${shownNote(groupTotal)}\n\n${(await fmt(list)).join('\n')}`, client);
      } else {
        await reply(message, '👥 Group unsent: 0 (none).', client);
      }
      const inboxTotal = counts.inbox;
      if (inboxTotal) {
        const list = unsentMod.listUnsentTyped('inbox', n) || [];
        await reply(message, `📥 *Inbox unsent: ${inboxTotal} total*${shownNote(inboxTotal)}\n\n${(await fmt(list)).join('\n')}`, client);
      } else {
        await reply(message, '📥 Inbox unsent: 0 (none).', client);
      }
      return true;
    }

    // ─── Clear Unsent Messages ───
    // /clearin → clear ALL inbox (private chat) unsent entries
    // /cleargp → clear ALL group unsent entries
    case '/clearin':
    case '/cleargp': {
      const unsentMod = require('./unsent');
      const mode = cmd === '/clearin' ? 'inbox' : 'group';
      const removed = unsentMod.clearUnsentTyped(mode);
      const label = mode === 'inbox' ? '📥 Inbox' : '👥 Group';
      await reply(message, removed > 0
        ? `🧹 ${label} unsent cleared! (${removed} message${removed > 1 ? 's' : ''} removed)`
        : `🧹 ${label} unsent already empty (0 to clear).`, client);
      return true;
    }

    // ─── Status ───
    case '/status': {
      const config = readJSON('config.json') || {};
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      let txt = `📊 *Bot Status*\n`;
      txt += `Bot: ${config.botEnabled !== false ? '🟢 ON' : '🔴 OFF'}\n`;
      txt += `Inbox: ${config.replyToInbox !== false ? '✅ ON' : '❌ OFF'}\n`;
      txt += `Groups: ${config.replyToGroups ? '✅ ON' : '❌ OFF'}\n`;
      txt += `Uptime: ${h}h ${m}m`;
      await reply(message, txt, client);
      return true;
    }

    // ─── Group List ───
    case '/gplist': {
      try {
        let groups = [];
        try {
          groups = await Promise.race([
            client.pupPage.evaluate(() => {
              try {
                const Chat = window.require('WAWebCollections').Chat;
                const models = Chat.getModelsArray();
                return models
                  .filter(c => c.isGroup)
                  .map(c => ({
                    name: c.formattedTitle || c.name || 'Unnamed',
                    id: c.id ? c.id._serialized : ''
                  }));
              } catch (e) { return []; }
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
          ]);
        } catch (e) {
          console.log('⚠️ gplist store failed:', e.message);
        }

        if (!groups || groups.length === 0) {
          await reply(message, '📋 Bot ke group e add karo.', client);
          return true;
        }

        let txt = `📋 *Groups (${groups.length}):*\n\n`;
        groups.forEach((g, i) => {
          txt += `${i + 1}. ${g.name}\n   ${g.id}\n\n`;
        });
        await reply(message, txt, client);
        return true;
      } catch (e) {
        console.error('❌ /gplist error:', e.message);
        await reply(message, '❌ Groups load korte paris na.', client);
        return true;
      }
    }

    // ─── Help ───
    case '/help': {
      const txt = `🤖 *Admin Commands*

*Bot Control:*
/onbot — Bot ON
/offbot — Bot OFF
/restart — Restart bot
/update — Pull update from GitHub
/clear — Clear cache data

*Reply Control:*
/oninbox — Inbox reply ON
/offinbox — Inbox reply OFF
/ongroup — Group reply ON
/offgroup — Group reply OFF

*AI Prompt:*
/aiprompt <text> — Update AI personality

*Block:*
/block <number> — Block
/unblock <number> — Unblock
/blocklist — Blocked list

*Unsent (max 30, auto-clean):*
/unsent — Show last 10 unsent (inbox + group)
/unsent <n> — Last n unsent (max 30)
/unsentin <n> — Last n inbox unsent
/unsentgp <n> — Last n group unsent
/clearin — Clear all inbox unsent
/cleargp — Clear all group unsent

*Memory System (admin):*
/memory — Status
/memory on|off — Global toggle
/memlist — List users with memory
/memview <number> — View memory
/analyzememory [number] — Run AI memory analysis
/memedit <number> <field> <value> — Edit
/memdel <number> — Delete memory
/memoff <number> — Disable user memory
/memon <number> — Enable user memory

*Privacy (any user):*
/mymemory — See what bot remembers about you
/forgetme — Delete your stored data

*Group Intelligence:*
/groupmode — Group behavior settings
/groupprompt <text> — Group personality prompt
/groupprompt reset — Default persona
/groupchance <0-1> — Global reply chance
/group <id> chatty|normal|mention — Per-group mode
/groupchance <id> <0-1> — Per-group chance
/groupreset <id> — Remove per-group settings
/grouplist — Configured groups
/reaction on|off — Emoji reactions
/groupai on|off — Hybrid AI decision flow

*Other:*
/gplist — Group list
/log <n> — Show last n logs
/status — Bot status
/help — Commands`;
      await reply(message, txt, client);
      return true;
    }

    // ─── Restart Bot ───
    case '/restart': {
      await reply(message, '🔄 Restarting bot...', client);
      console.log('🔄 Restart triggered via /restart command');
      setTimeout(() => {
        const { spawn } = require('child_process');
        const cwd = require('path').join(__dirname, '..', '..');
        const child = spawn('node', ['index.js'], { detached: true, stdio: 'ignore', cwd });
        child.unref();
        process.exit(0);
      }, 800);
      return true;
    }

    // ─── Update AI Prompt ───
    case '/aiprompt': {
      if (!param) {
        const config = readJSON('config.json') || {};
        const current = config.botPrompt || '(not set)';
        await reply(message, `📝 *Current AI Prompt:*\n\n${current}\n\nUse: /aiprompt <new prompt>`, client);
        return true;
      }
      setConfig('botPrompt', param);
      console.log(`📝 AI Prompt updated via command`);
      await reply(message, `✅ AI Personality Prompt updated!\n\n*New:*\n${param.substring(0, 200)}${param.length > 200 ? '...' : ''}`, client);
      return true;
    }

    // ─── Group Conversation Intelligence ───
    case '/groupmode': {
      const config = readJSON('config.json') || {};
      const chance = parseFloat(config.groupReplyChance) || 0.25;
      const cooldown = parseInt(config.groupCooldownSec) || 45;
      const reactions = config.reactionsEnabled !== false;
      const questionBoost = parseFloat(config.questionBoostChance) || 0.6;
      const customGroups = Object.keys(config.groupSettings || {}).length;
      let txt = `🧠 *Group Intelligence*\n\n`;
      txt += `Random reply chance: ${Math.round(chance * 100)}%\n`;
      txt += `Question boost: ${Math.round(questionBoost * 100)}%\n`;
      txt += `Cooldown: ${cooldown}s\n`;
      txt += `Reactions: ${reactions ? '✅ ON' : '❌ OFF'}\n`;
      txt += `Group prompt: ${(config.groupPrompt || '').trim() ? 'custom ✅' : 'default persona'}\n`;
      txt += `Per-group settings: ${customGroups} group${customGroups === 1 ? '' : 's'}\n\n`;
      txt += `*Commands:*\n/groupprompt <text> — group personality\n/groupprompt reset — default persona\n/groupchance <0-1> — global chance\n/group <id> chatty|normal|mention — per-group mode\n/groupchance <id> <0-1> — per-group chance\n/groupreset <id> — remove per-group settings\n/grouplist — configured groups\n/reaction on|off — emoji reactions\n/groupai on|off — hybrid AI decision flow`;
      await reply(message, txt, client);
      return true;
    }
    case '/group': {
      // /group <groupId> <chatty|normal|mention>
      const gIntel = require('./group-intel');
      const config = readJSON('config.json') || {};
      const parts = param.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2 || !['chatty', 'normal', 'mention'].includes(parts[1].toLowerCase())) {
        await reply(message, '❌ Usage: /group <groupId> <chatty|normal|mention>\n(Group ID pawa jabe /gplist diye)', client);
        return true;
      }
      const mode = parts[1].toLowerCase();
      config.groupSettings = gIntel.setGroupMode(parts[0], mode, config);
      writeJSON('config.json', config);
      const label = mode === 'chatty' ? '💬 Chatty (high participation)' : mode === 'mention' ? '🔇 Mention-only' : '⚖️ Normal (hybrid)';
      await reply(message, `✅ Group mode set: ${label}\n(ID: ${gIntel.cleanGroupId(parts[0])})`, client);
      return true;
    }
    case '/groupreset': {
      const gIntel = require('./group-intel');
      const config = readJSON('config.json') || {};
      if (!param.trim()) { await reply(message, '❌ Usage: /groupreset <groupId>', client); return true; }
      config.groupSettings = gIntel.resetGroupSettings(param.trim(), config);
      writeJSON('config.json', config);
      await reply(message, `🧹 Per-group settings removed for ${param.trim()}. Bot ekhon global rules follow korbe.`, client);
      return true;
    }
    case '/grouplist': {
      const gIntel = require('./group-intel');
      const config = readJSON('config.json') || {};
      const gs = config.groupSettings || {};
      const keys = Object.keys(gs);
      if (keys.length === 0) {
        await reply(message, '🧠 Kono per-group setting nei. Sob group global rules follow kore.\nSet korte: /group <groupId> <mode>', client);
        return true;
      }
      let txt = `🧠 *Configured Groups (${keys.length}):*\n\n`;
      for (const [id, s] of Object.entries(gs)) {
        const chanceTxt = typeof s.chance === 'number' ? ` | chance ${Math.round(s.chance * 100)}%` : '';
        const modeTxt = s.mode === 'chatty' ? '💬 chatty' : s.mode === 'mention' ? '🔇 mention' : '⚖️ normal';
        txt += `• ${id} → ${modeTxt}${chanceTxt}\n`;
      }
      txt += `\nRemove: /groupreset <id>`;
      await reply(message, txt.substring(0, 1800), client);
      return true;
    }
    case '/groupchance': {
      const gIntel = require('./group-intel');
      const config = readJSON('config.json') || {};
      const parts = param.trim().split(/\s+/).filter(Boolean);
      // per-group: /groupchance <groupId> <0-1>   |   global: /groupchance <0-1>
      const isPerGroup = parts.length >= 2 && /\d/.test(parts[0]);
      const valIdx = isPerGroup ? 1 : 0;
      const val = parseFloat(parts[valIdx]);
      if (isNaN(val) || val < 0 || val > 1) {
        await reply(message, '❌ Usage: /groupchance <0-1> (global)\n/groupchance <groupId> <0-1> (per-group)', client);
        return true;
      }
      if (isPerGroup) {
        config.groupSettings = gIntel.setGroupChance(parts[0], val, config);
        writeJSON('config.json', config);
        await reply(message, `✅ Per-group chance: ${gIntel.cleanGroupId(parts[0])} → ${Math.round(val * 100)}%`, client);
      } else {
        setConfig('groupReplyChance', val);
        await reply(message, `✅ Global random group reply chance: ${Math.round(val * 100)}%`, client);
      }
      return true;
    }
    case '/groupprompt': {
      const config = readJSON('config.json') || {};
      if (!param || param.toLowerCase() === 'reset') {
        const current = config.groupPrompt ? '\n\n*Current:*\n' + config.groupPrompt.substring(0, 300) : '';
        await reply(message, `📝 *Group Personality Prompt*${current}\n\nUse: /groupprompt <text> — set it\n/groupprompt reset — default friendly persona`, client);
        return true;
      }
      setConfig('groupPrompt', param);
      console.log('🧠 Group prompt updated via command');
      await reply(message, `✅ Group personality prompt updated!\n\n*New:*\n${param.substring(0, 200)}${param.length > 200 ? '...' : ''}`, client);
      return true;
    }
    case '/reaction': {
      const mode = param.trim().toLowerCase();
      if (mode === 'on') { setConfig('reactionsEnabled', true); await reply(message, '😀 Emoji reactions: ✅ ON', client); return true; }
      if (mode === 'off') { setConfig('reactionsEnabled', false); await reply(message, '😀 Emoji reactions: ❌ OFF', client); return true; }
      await reply(message, '❌ Usage: /reaction on|off', client);
      return true;
    }
    case '/groupai': {
      // Hybrid AI decision flow master switch
      const mode = param.trim().toLowerCase();
      if (mode === 'on') {
        setConfig('groupAiEnabled', true);
        await reply(message, '🧠 Group AI intelligence: ✅ ON\n\nHybrid flow: direct → always reply · open questions → reply · unclear → AI decides · human chats → silent', client);
        return true;
      }
      if (mode === 'off') {
        setConfig('groupAiEnabled', false);
        await reply(message, '🧠 Group AI intelligence: ❌ OFF (mention/direct-only behavior)', client);
        return true;
      }
      await reply(message, '❌ Usage: /groupai on|off', client);
      return true;
    }

    // ─── Git Update ───
    case '/update': {
      await reply(message, '📥 Pulling update from GitHub...', client);
      console.log('📥 /update triggered');
      const { execSync } = require('child_process');
      const cwd = require('path').join(__dirname, '..', '..');
      try {
        const pullOutput = execSync('git pull origin main', { cwd, timeout: 30000, encoding: 'utf-8' });
        if (pullOutput.includes('Already up to date') || pullOutput.includes('Already up-to-date')) {
          await reply(message, '✅ Bot is already up to date! No update available.', client);
          console.log('✅ /update: no update available');
          return true;
        }
        await reply(message, '📦 New update found! Installing dependencies...', client);
        execSync('npm install --production', { cwd, timeout: 60000 });
        await reply(message, '✅ Update complete! Restarting...', client);
        console.log('✅ /update complete, restarting...');
        setTimeout(() => {
          const { spawn } = require('child_process');
          const child = spawn('node', ['index.js'], { detached: true, stdio: 'ignore', cwd });
          child.unref();
          process.exit(0);
        }, 800);
      } catch (e) {
        await reply(message, `❌ Update failed: ${e.message.substring(0, 200)}`, client);
        console.error('❌ /update failed:', e.message);
      }
      return true;
    }

    // ─── User Memory System (admin) ───
    case '/memory': {
      const memoryService = require('../memory/service');
      const paramLower = param.trim().toLowerCase();
      if (paramLower === 'on') {
        memoryService.setGlobalEnabled(true);
        await reply(message, '🧠 Memory system: ✅ ON', client);
        return true;
      }
      if (paramLower === 'off') {
        memoryService.setGlobalEnabled(false);
        await reply(message, '🧠 Memory system: ❌ OFF', client);
        return true;
      }
      const users = memoryService.listProfiles();
      const enabled = memoryService.isGloballyEnabled();
      let txt = `🧠 *Memory System:* ${enabled ? '✅ ON' : '❌ OFF'}\n`;
      txt += `👥 Users: ${users.length}\n\n`;
      txt += `*Commands:*\n/memory on|off — global toggle\n/memlist — list users\n/memview <number> — view\n/analyzememory [number] — run AI analysis\n/memedit <number> <field> <value> — edit\n/memdel <number> — delete\n/memoff <number> — disable user\n/memon <number> — enable user`;
      await reply(message, txt, client);
      return true;
    }
    case '/memlist': {
      const memoryService = require('../memory/service');
      const users = memoryService.listProfiles();
      if (users.length === 0) {
        await reply(message, '🧠 Kono user memory nei (0 users).', client);
        return true;
      }
      let txt = `🧠 *Users with memory (${users.length}):*\n\n`;
      users.slice(0, 30).forEach((u, i) => {
        const last = u.lastInteraction ? new Date(u.lastInteraction).toLocaleString() : '—';
        txt += `${i + 1}. ${u.name || u.key}\n   📱 ${u.key} | ${u.memoryEnabled ? '✅' : '❌'} | ${u.totalMessages} msgs | ${last}\n\n`;
      });
      await reply(message, txt.substring(0, 1800), client);
      return true;
    }
    case '/memview': {
      const memoryService = require('../memory/service');
      const key = memoryService.getUserKey(param);
      const profile = memoryService.getProfile(key);
      if (!profile) {
        await reply(message, `🧠 Memory pai nai: ${param || '(no number)'}`, client);
        return true;
      }
      let txt = `🧠 *Memory: ${profile.name || key}*\n`;
      txt += `📱 Key: ${key}\n`;
      txt += `🗣️ Language: ${memLang(profile.language)} | 💬 Style: ${profile.style || '—'}\n`;
      if ((profile.habits || []).length) txt += `🔄 Habits: ${profile.habits.join(', ')}\n`;
      if (profile.interests.length) txt += `⭐ Interests: ${profile.interests.join(', ')}\n`;
      if (profile.preferences.length) txt += `👍 Preferences: ${profile.preferences.join('; ')}\n`;
      if (profile.facts.length) txt += `📌 Facts: ${profile.facts.join('; ')}\n`;
      if (profile.notes) txt += `📝 Notes: ${profile.notes}\n`;
      txt += `📅 Last: ${profile.lastInteraction ? new Date(profile.lastInteraction).toLocaleString() : '—'}`;
      if (profile.lastAnalyzedAt) txt += ` | 🕒 AI analyzed: ${new Date(profile.lastAnalyzedAt).toLocaleString()}`;
      if (profile.analyzedMessageCount) txt += ` (${profile.analyzedMessageCount} msgs)`;
      await reply(message, txt.substring(0, 1800), client);
      return true;
    }
    case '/memdel': {
      const memoryService = require('../memory/service');
      const key = memoryService.getUserKey(param);
      if (!key) { await reply(message, '❌ Usage: /memdel <number>', client); return true; }
      memoryService.deleteProfile(key);
      await reply(message, `🧹 Memory deleted for ${param}`, client);
      return true;
    }
    case '/memoff':
    case '/memon': {
      const memoryService = require('../memory/service');
      const key = memoryService.getUserKey(param);
      if (!key) { await reply(message, `❌ Usage: ${cmd} <number>`, client); return true; }
      memoryService.setUserEnabled(key, cmd === '/memon');
      await reply(message, `🧠 Memory ${cmd === '/memon' ? 'ENABLED ✅' : 'DISABLED ❌'} for ${param}`, client);
      return true;
    }
    case '/analyzememory': {
      // Run AI memory extraction now — /analyzememory [number] (defaults to sender)
      const memoryService = require('../memory/service');
      const target = param.trim();
      const key = target ? memoryService.getUserKey(target) : memoryService.getUserKey(senderId);
      if (!key) { await reply(message, '❌ Usage: /analyzememory [number]', client); return true; }
      await reply(message, '🧠 Memory analysis started... (ektu somoy lagbe, AI thakle)', client);
      const profile = await memoryService.analyzeUserMemory(key);
      if (!profile) {
        await reply(message, '⚠️ Analysis complete — no changes. Komporkhe 3+ messages lagbe ebong AI provider active thakte hobe.', client);
        return true;
      }
      let txt = `🧠 *Memory analysis complete:*\n👤 Name: ${profile.name || '—'}\n🗣️ Language: ${memLang(profile.language)} | 💬 Style: ${profile.style || '—'}\n`;
      if ((profile.habits || []).length) txt += `🔄 Habits: ${profile.habits.join(', ')}\n`;
      if (profile.interests.length) txt += `⭐ Interests: ${profile.interests.join(', ')}\n`;
      if (profile.preferences.length) txt += `👍 Preferences: ${profile.preferences.join('; ')}\n`;
      if (profile.facts.length) txt += `📌 Facts: ${profile.facts.join('; ')}\n`;
      txt += `📊 Messages analyzed: ${profile.analyzedMessageCount}`;
      await reply(message, txt.substring(0, 1800), client);
      return true;
    }
    case '/memedit': {
      // /memedit <number> <field> <value...>
      // fields: name, language, style, notes | interests(+/-), facts(+/-), preferences(+/-)
      const memoryService = require('../memory/service');
      const parts = param.split(' ').filter(Boolean);
      if (parts.length < 3) {
        await reply(message, '❌ Usage: /memedit <number> <field> <value>\nFields: name, language, style, notes, interests, facts, preferences, habits\nList fields: interests+ cricket (add) | facts- something (remove)', client);
        return true;
      }
      const key = memoryService.getUserKey(parts[0]);
      const field = parts[1].toLowerCase();
      const value = parts.slice(2).join(' ');
      const baseField = field.replace(/[+-]$/, '');
      const isListField = ['interests', 'facts', 'preferences', 'habits'].includes(baseField);
      if (isListField) {
        const profile = memoryService.getOrCreateProfile(key, parts[0]);
        const list = profile[baseField] || [];
        if (field.endsWith('-')) {
          profile[baseField] = list.filter(x => x.toLowerCase() !== value.toLowerCase());
          await reply(message, `🧠 ${baseField} -= "${value}"`, client);
        } else {
          if (!list.some(x => x.toLowerCase() === value.toLowerCase())) {
            list.push(value.slice(0, 80));
            if (list.length > 10) list.shift();
          }
          await reply(message, `🧠 ${baseField} += "${value}"`, client);
        }
        memoryService.updateProfile(key, profile);
        return true;
      }
      if (field === 'name') memoryService.updateProfile(key, { name: value });
      else if (field === 'language') memoryService.updateProfile(key, { language: value });
      else if (field === 'style') memoryService.updateProfile(key, { style: value });
      else if (field === 'notes') memoryService.updateProfile(key, { notes: value });
      else { await reply(message, `❌ Unknown field: ${field}`, client); return true; }
      await reply(message, `🧠 ${field} updated for ${parts[0]}`, client);
      return true;
    }

    // ─── Show Logs ───
    case '/log': {
      const lines = parseInt(param) || 20;
      const count = Math.min(Math.max(lines, 1), 50);
      try {
        const fs = require('fs');
        const path = require('path');
        const logFile = path.join(__dirname, '..', '..', 'bot.log');
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8');
          const allLines = content.trim().split('\n');
          const recent = allLines.slice(-count);
          await reply(message, `📋 *Last ${recent.length} logs:*\n\n\`\`\`\n${recent.join('\n').substring(0, 1800)}\n\`\`\``, client);
        } else {
          // Fallback: send from in-memory log buffer via routes
          await reply(message, '📋 Log file not found. Check dashboard Live Logs tab.', client);
        }
      } catch (e) {
        await reply(message, '📋 Logs unavailable. Check dashboard Live Logs tab.', client);
      }
      return true;
    }

    // ─── Clear Cache ───
    case '/clear': {
      await reply(message, '🧹 Clearing cache...', client);
      const fs = require('fs');
      const path = require('path');
      const cwd = path.join(__dirname, '..', '..');
      let cleared = 0;

      const targets = [
        { name: '.wwebjs_cache', isDir: true },
        { name: 'tmp', isDir: true }
      ];

      for (const t of targets) {
        const p = path.join(cwd, t.name);
        if (fs.existsSync(p)) {
          try { fs.rmSync(p, { recursive: true, force: true }); cleared++; } catch (e) {}
        }
      }

      // Clean Chrome cache inside session
      const sessionDir = path.join(cwd, '.wwebjs_auth', 'session');
      if (fs.existsSync(sessionDir)) {
        const cacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Blob_storage'];
        for (const folder of cacheFolders) {
          const fp = path.join(sessionDir, folder);
          if (fs.existsSync(fp)) {
            try { fs.rmSync(fp, { recursive: true, force: true }); cleared++; } catch (e) {}
          }
        }
        const defaultDir = path.join(sessionDir, 'Default');
        if (fs.existsSync(defaultDir)) {
          for (const folder of cacheFolders) {
            const fp = path.join(defaultDir, folder);
            if (fs.existsSync(fp)) {
              try { fs.rmSync(fp, { recursive: true, force: true }); cleared++; } catch (e) {}
            }
          }
          const lockFiles = fs.readdirSync(defaultDir).filter(f => f.endsWith('.lock') || f === 'LOCK' || f === 'lockfile');
          for (const lf of lockFiles) {
            try { fs.unlinkSync(path.join(defaultDir, lf)); cleared++; } catch (e) {}
          }
        }
      }

      // Remove stale Chrome lock files
      const lockNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const lf of lockNames) {
        try { fs.unlinkSync(path.join(sessionDir, lf)); cleared++; } catch (e) {}
      }

      console.log(`🧹 Cache cleared (${cleared} items)`);
      await reply(message, `✅ Cache cleared! (${cleared} items removed)\n\nWhatsApp session & API keys are safe.`, client);
      return true;
    }

    default:
      await reply(message, `❌ Unknown: ${cmd}\nType /help`, client);
      return true;
  }
}

module.exports = { handleCommand, isAdminUser };
