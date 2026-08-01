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

async function handleCommand(message, client, botWid, lidMap, commandSenderId) {
  const body = message.body.trim();
  if (!body.startsWith('/')) return false;

  const senderId = commandSenderId || message.from;
  console.log(`🔍 Command: "${body}" from ${senderId} (chat: ${message.from})`);

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
