/**
 * WhatsApp Client — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { handleMessage } = require('./handler');
const { autoClean } = require('./cache');
const { saveUnsent } = require('./unsent');
const { execSync } = require('child_process');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled rejection:', err?.message || err);
});

// A working Chrome build needs its ICU data and resource pack next to the
// binary. A corrupt Puppeteer download or a half-installed distro Chromium is
// missing these and will fail at launch ("Invalid file descriptor to ICU
// data" / "Failed to launch the browser process"). Check before trusting it.
function chromeDataOk(bin) {
  const fs = require('fs');
  let real = bin;
  try { real = fs.realpathSync(bin); } catch (e) {}
  const dirs = [path.dirname(real)];
  const base = path.basename(real);
  if (base === 'chromium' || base === 'chromium-browser') {
    dirs.push('/usr/lib/chromium', '/usr/lib/chromium-browser');
  }
  for (const d of dirs) {
    try {
      if (fs.existsSync(path.join(d, 'icudtl.dat')) && fs.existsSync(path.join(d, 'resources.pak'))) {
        return true;
      }
    } catch (e) {}
  }
  return false;
}

function findChrome() {
  const fs = require('fs');
  const os = require('os');
  const paths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p) && chromeDataOk(p)) return p;
    } catch (e) {}
  }
  // Look inside the Puppeteer browser cache (works on any user/system)
  try {
    const cacheRoots = [
      path.join(os.homedir(), '.cache', 'puppeteer'),
      '/root/.cache/puppeteer',
      process.env.PUPPETEER_CACHE_DIR,
    ].filter(Boolean);
    for (const root of cacheRoots) {
      const chromeDir = path.join(root, 'chrome');
      if (!fs.existsSync(chromeDir)) continue;
      const versions = fs.readdirSync(chromeDir).sort().reverse();
      for (const ver of versions) {
        const candidates = [
          path.join(chromeDir, ver, 'chrome-linux64', 'chrome'),
          path.join(chromeDir, ver, 'chrome-linux', 'chrome'),
          path.join(chromeDir, ver, 'chrome-win64', 'chrome.exe'),
          path.join(chromeDir, ver, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        ];
        for (const c of candidates) {
          try { if (fs.existsSync(c) && chromeDataOk(c)) return c; } catch (e) {}
        }
      }
    }
  } catch (e) {}
  try {
    const found = execSync('which chromium chromium-browser google-chrome google-chrome-stable 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (found) return found.split('\n')[0];
  } catch (e) {}
  return undefined;
}

const chromePath = findChrome();
if (chromePath) {
  console.log(`🌐 Chrome: ${chromePath}`);
} else {
  console.log('⚠️ No Chrome found — Puppeteer will download its own');
}

const args = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--window-size=1280,720',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-default-browser-check',
  // ── Anti-sleep: stop Chrome from throttling/freezing the WhatsApp tab so
  // the bot stays responsive 24/7 instead of silently "falling asleep". ──
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-ipc-flooding-protection',
  '--disable-hang-monitor',
  '--disable-background-media-suspend',
];

const puppeteerConfig = {
  headless: true,
  args,
  defaultViewport: { width: 1280, height: 720 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

if (chromePath) {
  puppeteerConfig.executablePath = chromePath;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: puppeteerConfig,
});

const botState = { status: 'offline', startTime: null, botWid: null, lidMap: {}, lastOnline: null };

function setBotStatus(status) {
  botState.status = status;
  if (status === 'online') botState.startTime = Date.now();
}

let onlineInterval = null;

// ─── Auto-reconnect: brings the bot back online by itself after a
// disconnect / auth failure so it never stays "asleep" until a manual
// restart. Uses increasing backoff (10s → 20s → 40s → … max 2 min).
let reconnecting = false;
let reconnectDelay = 10000;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnecting || reconnectTimer) return;
  reconnecting = true;
  const delay = reconnectDelay;
  console.log(`🔄 Auto-reconnect in ${Math.round(delay / 1000)}s...`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      // Client came back online on its own while we were waiting → skip
      if (botState.status === 'online') {
        reconnectDelay = 10000;
        return;
      }
      botState.status = 'offline';
      qrShown = false; // log a fresh QR if the session expired
      // whatsapp-web.js requires the old client to be destroyed before
      // re-initializing — otherwise initialize() throws "already initialized"
      // and the in-process reconnect never recovers (only the watchdog would).
      // Re-check status right before destroying: the client may have recovered
      // on its own while we were waiting, and we must not kill a live session.
      if (botState.status === 'online') {
        reconnectDelay = 10000;
        return;
      }
      try { await client.destroy(); } catch (e) {}
      await client.initialize();
      reconnectDelay = 10000;
      console.log('✅ Reconnect attempt finished');
    } catch (e) {
      console.error(`❌ Reconnect failed: ${e.message}`);
      reconnectDelay = Math.min(reconnectDelay * 2, 120000);
    } finally {
      reconnecting = false;
      // If we're still not online, try again with backoff
      if (botState.status !== 'online') scheduleReconnect();
    }
  }, delay);
}

function cleanWid(id) {
  return String(id).replace(/@c\.us/, '').replace(/@lid/, '').replace(/@g\.us/, '');
}

// Robust LID resolver — tries WWebJS internal modules first, then contact lookup
async function resolveLid(senderId) {
  const senderStr = String(senderId);
  const lid = cleanWid(senderStr);

  // Try pre-populated map first
  if (botState.lidMap[lid]) {
    console.log(`🔍 resolveLid cache: ${senderStr} → ${botState.lidMap[lid]}`);
    return botState.lidMap[lid];
  }

  // Method 1: WWebJS internal WAWebLidMigrationUtils.toPn()
  try {
    const phone = await client.pupPage.evaluate((id) => {
      try {
        const Wids = window.require('WAWebWidFactory');
        const LidMigration = window.require('WAWebLidMigrationUtils');
        const wid = Wids.createWid(id);
        if (wid && typeof wid.isLid === 'function' && wid.isLid()) {
          const pn = LidMigration.toPn(wid);
          if (pn) return pn._serialized || String(pn);
        }
      } catch (e) {}
      return null;
    }, senderStr);
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      botState.lidMap[lid] = cleanPhone;
      botState.lidMap[cleanPhone] = lid;
      console.log(`🔍 resolveLid (toPn): ${senderStr} → ${cleanPhone}`);
      return cleanPhone;
    }
  } catch (e) {}

  // Method 2: WWebJS contact store — iterate contacts to find LID match
  try {
    const result = await client.pupPage.evaluate((searchId) => {
      try {
        const Store = window.require('WAWebCollections');
        const coll = Store.Contact?.getStoreModel?.()?.collection;
        if (!coll) return null;
        for (const c of coll) {
          try {
            const serialized = c.id?._serialized || String(c.id || '');
            if (serialized === searchId) {
              const phone = c.phonebookEntry?.iPN || c.number || '';
              if (phone) return String(phone).replace(/\D/g, '');
            }
          } catch (e) {}
        }
      } catch (e) {}
      return null;
    }, senderStr);
    if (result) {
      botState.lidMap[lid] = result;
      botState.lidMap[result] = lid;
      console.log(`🔍 resolveLid (store): ${senderStr} → ${result}`);
      return result;
    }
  } catch (e) {}

  // Method 3: client.getContactById()
  try {
    const contact = await client.getContactById(senderStr);
    if (contact && contact.number) {
      const phone = contact.number.replace(/\D/g, '');
      if (phone) {
        botState.lidMap[lid] = phone;
        botState.lidMap[phone] = lid;
        console.log(`🔍 resolveLid (contact): ${senderStr} → ${phone}`);
        return phone;
      }
    }
  } catch (e) {}

  console.log(`🔍 resolveLid: no result for ${senderStr}`);
  return null;
}

// Pre-populate LID map from all known contacts on startup
async function prepopulateLidMap() {
  try {
    const pairs = await client.pupPage.evaluate(() => {
      try {
        const Store = window.require('WAWebCollections');
        const coll = Store.Contact?.getStoreModel?.()?.collection;
        if (!coll) return [];
        const result = [];
        for (const c of coll) {
          try {
            const serialized = c.id?._serialized || String(c.id || '');
            const phone = c.phonebookEntry?.iPN || c.number || '';
            const lid = serialized.replace(/@lid/, '').replace(/@c\.us/, '');
            const cleanPhone = String(phone).replace(/\D/g, '');
            if (lid && cleanPhone) result.push([lid, cleanPhone]);
          } catch (e) {}
        }
        return result;
      } catch (e) { return []; }
    });
    for (const [lid, phone] of pairs) {
      botState.lidMap[lid] = phone;
      botState.lidMap[phone] = lid;
    }
    console.log(`📋 LID map pre-populated: ${pairs.length} contacts`);
  } catch (e) {
    console.log(`📋 LID pre-populate skipped: ${e.message}`);
  }
}

client.on('loading_screen', (percent, message) => {
  console.log(`🔄 Loading: ${percent}% - ${message}`);
});

let qrShown = false;
client.on('qr', async (qr) => {
  if (!qrShown) {
    console.log('📱 QR ready — pair from Admin Panel → WhatsApp Login');
    qrShown = true;
  }
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp authenticated!');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Auth failed:', msg);
  botState.status = 'offline';
  if (onlineInterval) clearInterval(onlineInterval);
  if (global._cacheCleanInterval) clearInterval(global._cacheCleanInterval);
  scheduleReconnect();
});

client.on('ready', async () => {
  // Set online FIRST so admin panel shows correct status immediately
  botState.status = 'online';
  botState.startTime = Date.now();
  botState.lastOnline = Date.now();
  // Cancel any pending reconnect so we never double-initialize a live client
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnecting = false;
  reconnectDelay = 10000;

  try {
    const wid = client.info.wid;
    const botWid = wid._serialized || wid;
    botState.botWid = botWid;
    console.log(`🟢 Bot ONLINE! WID: ${botWid}`);
  } catch (e) {
    console.log(`🟢 Bot ONLINE! (WID pending: ${e.message})`);
  }

  try { await client.sendPresenceAvailable(); } catch (e) {}

  // Pre-populate LID map from contacts
  try { await prepopulateLidMap(); } catch (e) {}

  // Resolve botWid to phone if it's a LID
  try {
    const botWid = botState.botWid || '';
    const botDigits = botWid.replace(/\D/g, '');
    if (botWid.includes('@lid') || (botState.lidMap[botDigits] && !botWid.includes('@c.us'))) {
      const resolved = botState.lidMap[botDigits];
      if (resolved) {
        botState.botWid = resolved + '@c.us';
        console.log(`🔍 botWid resolved: ${botWid} → ${botState.botWid}`);
      }
    }
  } catch (e) {}

  // Periodic cache auto-clean every 15 min (keeps the browser from sleeping).
  // Runs only when there is actually a cache to clean.
  if (global._cacheCleanInterval) clearInterval(global._cacheCleanInterval);
  global._cacheCleanInterval = setInterval(() => {
    try { autoClean(); } catch (e) {}
  }, 15 * 60 * 1000);

  if (onlineInterval) clearInterval(onlineInterval);
  onlineInterval = setInterval(async () => {
    try { await client.sendPresenceAvailable(); } catch (e) {}
  }, 120000);
});

client.on('disconnected', (reason) => {
  console.log('🔴 Disconnected:', reason);
  botState.status = 'offline';
  if (onlineInterval) clearInterval(onlineInterval);
  if (global._cacheCleanInterval) clearInterval(global._cacheCleanInterval);
  scheduleReconnect();
});

// Use message_create to catch ALL messages including self-sent
// (library's 'message' event = MESSAGE_RECEIVED, skips fromMe)
client.on('message_create', async (message) => {
  cacheRecentMessage(message);
  await handleMessage(message, client);
});

// ─── Unsent (revoked) message tracking ───
// whatsapp-web.js only keeps the LAST seen message, so for a message unsent
// minutes later it hands us a revoke event with NO original text. We keep our
// own rolling cache of every received message (id → content) so the original
// body of ANY unsent message can be recovered — new or old. The cache is
// purely an index for recovery: messages are NEVER recorded as unsent just
// because they are in this cache. Only real revoke events create records.
const recentMessages = new Map();
const RECENT_MSG_LIMIT = 2000;

function cacheRecentMessage(message) {
  try {
    const mid = (message.id && (message.id._serialized || message.id.id)) || '';
    if (!mid) return;
    recentMessages.set(mid, {
      from: message.from,
      author: message.author || message.from,
      body: message.body || '',
      timestamp: message.timestamp,
      msgType: message.type || 'chat',
      type: String(message.from || '').endsWith('@g.us') ? 'group' : 'inbox'
    });
    // Trim oldest entries when the cache grows too large
    if (recentMessages.size > RECENT_MSG_LIMIT) {
      const oldest = recentMessages.keys().next().value;
      recentMessages.delete(oldest);
    }
  } catch (e) {}
}

// Record an ACTUALLY deleted-for-everyone message into /unsent.
// This handler is only ever invoked by the library's message_revoke_everyone
// event (real "Delete for everyone"), never for normal messages. Age of the
// message is irrelevant — a message unsent 5 minutes (or longer) after being
// sent is matched by its original WhatsApp message ID.
client.on('message_revoke_everyone', async (message, revokedMsg) => {
  try {
    // Never track the bot's OWN unsent messages
    if (message.fromMe) return;

    const mid = (message.id && (message.id._serialized || message.id.id)) || '';
    const isGroup = String(message.from || '').endsWith('@g.us');

    console.log(`🚫 Actual revoke event received — counting as UNSENT (${isGroup ? 'group' : 'inbox'})`);

    // Recover the original message. Order:
    // 1) The library's revokedMsg (original data — only for the last-seen msg)
    // 2) Our rolling recent-message cache (any message seen recently, old or new)
    // 3) Best-effort fetch from the page store before it is fully cleared
    let body = '';
    let from = message.from;
    let author = message.author || message.from;
    let timestamp = message.timestamp;
    let msgType = message.type || 'chat';

    // NOTE: by the time the revoke event fires, the store message's type is
    // already 'revoked' and its body cleared — so we ONLY trust revokedMsg
    // when it still carries real content. Our rolling cache always holds the
    // ORIGINAL body, so it is the primary recovery source for old deletes.
    if (revokedMsg && revokedMsg.body) {
      body = revokedMsg.body;
      from = revokedMsg.from || from;
      author = revokedMsg.author || revokedMsg.from || author;
      timestamp = revokedMsg.timestamp || timestamp;
      msgType = (revokedMsg.type && revokedMsg.type !== 'revoked') ? revokedMsg.type : msgType;
    } else if (mid) {
      const cached = recentMessages.get(mid);
      if (cached) {
        body = cached.body;
        from = cached.from || from;
        author = cached.author || author;
        timestamp = cached.timestamp || timestamp;
        msgType = cached.msgType || msgType;
      }
    }
    if (!body) {
      // Old message with no cached copy — fetch from the page store (best effort).
      try {
        const fetched = await client.pupPage.evaluate((id) => {
          try {
            const Msg = window.require('WAWebCollections').Msg;
            const m = Msg.get(id);
            if (m) return { body: m.body || m.rawObj?.body || '', from: m.id?._serialized || '', author: m.author?._serialized || m.author || '', timestamp: m.t, type: m.type || '' };
          } catch (e) {}
          return null;
        }, mid);
        if (fetched) {
          body = fetched.body || body;
          if (fetched.from) from = fetched.from;
          if (fetched.author) author = fetched.author;
          if (fetched.timestamp) timestamp = fetched.timestamp;
          if (fetched.type && fetched.type !== 'revoked') msgType = fetched.type;
        }
      } catch (e) {}
    }

    // Sender display name (best effort: pushname → saved name → number)
    let senderName = '';
    try {
      const contact = await client.getContactById(author || from);
      senderName = contact.pushname || contact.name || contact.shortName || contact.number || '';
    } catch (e) {}

    // Chat display name (group name) for friendlier /unsent output
    let chatName = '';
    try {
      const chat = await client.getChatById(message.from);
      chatName = chat.name || '';
    } catch (e) {}

    const result = saveUnsent({
      msgId: mid,
      chatId: message.from,
      type: isGroup ? 'group' : 'inbox',
      sender: author,
      senderName,
      name: isGroup ? chatName : '',
      body: body || '[Unsent message — content unavailable]',
      msgType,
      originalTs: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      deletedTs: new Date().toISOString(),
      status: 'UNSENT'
    });

    if (result.duplicate) {
      console.log(`🔁 Duplicate revoke event ignored (already recorded): ${mid}`);
      return;
    }

    if (body) {
      console.log(`🎯 Matched original message ID: ${mid}`);
    } else {
      console.log(`⚠️ Unmatched revoke event — original content unavailable for ID: ${mid}`);
    }
    console.log(`🚫 UNSENT saved (${isGroup ? 'group' : 'inbox'}) from ${senderName || author}: "${String(body).slice(0, 60)}"`);
  } catch (e) {
    console.error('❌ Revoke handling error:', e.message);
  }
});

module.exports = { client, botState, setBotStatus, resolveLid };
