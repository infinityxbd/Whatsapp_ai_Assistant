/**
 * WhatsApp Client — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { handleMessage } = require('./handler');
const { execSync } = require('child_process');

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled rejection:', err?.message || err);
});

function findChrome() {
  const paths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/home/codespace/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome',
    '/home/codespace/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome',
  ];
  for (const p of paths) {
    try {
      if (require('fs').existsSync(p)) return p;
    } catch (e) {}
  }
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

const botState = { status: 'offline', startTime: null, botWid: null, lidMap: {} };

function setBotStatus(status) {
  botState.status = status;
  if (status === 'online') botState.startTime = Date.now();
}

let onlineInterval = null;

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
});

client.on('ready', async () => {
  // Set online FIRST so admin panel shows correct status immediately
  botState.status = 'online';
  botState.startTime = Date.now();

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

  // Periodic cache auto-clean every 30 min
  if (global._cacheCleanInterval) clearInterval(global._cacheCleanInterval);
  global._cacheCleanInterval = setInterval(() => {
    try {
      const fs = require('fs');
      const p = require('path');
      const cacheDir = p.join(__dirname, '..', '..', '.wwebjs_cache');
      if (fs.existsSync(cacheDir)) { fs.rmSync(cacheDir, { recursive: true, force: true }); }
      const sessionDir = p.join(__dirname, '..', '..', '.wwebjs_auth', 'session');
      if (fs.existsSync(sessionDir)) {
        for (const folder of ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Blob_storage']) {
          const fp = p.join(sessionDir, folder);
          if (fs.existsSync(fp)) { try { fs.rmSync(fp, { recursive: true, force: true }); } catch (e) {} }
        }
        const defaultDir = p.join(sessionDir, 'Default');
        if (fs.existsSync(defaultDir)) {
          for (const folder of ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Blob_storage']) {
            const fp = p.join(defaultDir, folder);
            if (fs.existsSync(fp)) { try { fs.rmSync(fp, { recursive: true, force: true }); } catch (e) {} }
          }
        }
      }
      console.log('🧹 Auto cache clean done');
    } catch (e) {}
  }, 30 * 60 * 1000);

  if (onlineInterval) clearInterval(onlineInterval);
  onlineInterval = setInterval(async () => {
    try { await client.sendPresenceAvailable(); } catch (e) {}
  }, 120000);
});

client.on('disconnected', (reason) => {
  console.log('🔴 Disconnected:', reason);
  botState.status = 'offline';
  if (onlineInterval) clearInterval(onlineInterval);
});

// Use message_create to catch ALL messages including self-sent
// (library's 'message' event = MESSAGE_RECEIVED, skips fromMe)
client.on('message_create', async (message) => {
  await handleMessage(message, client);
});

module.exports = { client, botState, setBotStatus, resolveLid };
