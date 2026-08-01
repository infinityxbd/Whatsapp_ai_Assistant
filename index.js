/**
 * WhatsApp AI Auto-Reply Bot
 * Developer: Tarif Ahmed (infinityX)
 * Co-Founder, Senior Admin @ Student Cyber Expert Force (SCEF)
 * Telegram: https://t.me/infinityxbd
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
  console.log('📦 Installing dependencies...');
  execSync('npm install --production', { cwd: __dirname, stdio: 'inherit' });
  console.log('✅ Dependencies installed\n');
}

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { readJSON, writeJSON } = require('./src/storage/store');
const createAdminServer = require('./src/admin/server');

function killStaleChrome() {
  try { require('child_process').execSync('killall -9 chrome chromium chromium-browser 2>/dev/null', { stdio: 'ignore' }); } catch (e) {}
}

function autoClean() {
  killStaleChrome();

  const baseDir = __dirname;

  // Wipe .wwebjs_cache entirely
  const cacheDir = path.join(baseDir, '.wwebjs_cache');
  if (fs.existsSync(cacheDir)) {
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (e) {}
  }

  // Wipe Chrome profile cache inside session (keep WhatsApp login data)
  const sessionDir = path.join(baseDir, '.wwebjs_auth', 'session');
  if (fs.existsSync(sessionDir)) {
    // Remove lock files
    const lockNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const lf of lockNames) {
      try { fs.unlinkSync(path.join(sessionDir, lf)); } catch (e) {}
    }

    // Remove Chrome cache folders (keeps WhatsApp session intact)
    const cacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Blob_storage'];
    for (const folder of cacheFolders) {
      const fp = path.join(sessionDir, folder);
      if (fs.existsSync(fp)) {
        try { fs.rmSync(fp, { recursive: true, force: true }); } catch (e) {}
      }
    }

    // Also clean Default subfolder caches
    const defaultDir = path.join(sessionDir, 'Default');
    if (fs.existsSync(defaultDir)) {
      const defaultCacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Blob_storage', 'Storage'];
      for (const folder of defaultCacheFolders) {
        const fp = path.join(defaultDir, folder);
        if (fs.existsSync(fp)) {
          try { fs.rmSync(fp, { recursive: true, force: true }); } catch (e) {}
        }
      }
      // Remove stale lockfiles
      const lockFiles = fs.readdirSync(defaultDir).filter(f => f.endsWith('.lock') || f === 'LOCK' || f === 'lockfile');
      for (const lf of lockFiles) {
        try { fs.unlinkSync(path.join(defaultDir, lf)); } catch (e) {}
      }
    }
  }

  console.log('🧹 Chrome cache cleared');
}

async function initDataFiles() {
  let config = readJSON('config.json');
  if (!config) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(defaultPassword, 10);
    config = {
      adminPasswordHash: hash,
      botPrompt: 'You are a helpful WhatsApp assistant. Reply naturally and concisely. Be friendly.',
      replyToInbox: true,
      replyToGroups: false,
      botName: 'AI Assistant',
      botEnabled: true
    };
    writeJSON('config.json', config);
    console.log('📁 Created default config.json');
  }

  if (!config.adminPasswordHash) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    config.adminPasswordHash = await bcrypt.hash(defaultPassword, 10);
    writeJSON('config.json', config);
    console.log('🔑 Generated admin password hash');
  }

  if (!readJSON('apikeys.json')) {
    writeJSON('apikeys.json', []);
    console.log('📁 Created empty apikeys.json');
  }

  if (!readJSON('blocklist.json')) {
    writeJSON('blocklist.json', { numbers: [], groups: [] });
    console.log('📁 Created empty blocklist.json');
  }

  if (!readJSON('adminusers.json') || !Array.isArray(readJSON('adminusers.json'))) {
    writeJSON('adminusers.json', []);
    console.log('📁 Created empty adminusers.json');
  }
}

async function main() {
  autoClean();

  console.log('\n' + '═'.repeat(55));
  console.log('   🤖 WhatsApp AI Auto-Reply Bot');
  console.log('═'.repeat(55) + '\n');

  await initDataFiles();

  const { botState, setBotStatus, client } = require('./src/bot/whatsapp');

  const adminPort = parseInt(process.env.ADMIN_PORT) || 3001;
  const adminApp = createAdminServer(botState, client);
  adminApp.listen(adminPort, () => {
    console.log('🌐 Admin Panel: http://localhost:' + adminPort + '/admin');
    console.log('🔐 Password: ' + (process.env.DEFAULT_ADMIN_PASSWORD || 'admin123') + '\n');
  });

  console.log('📱 Starting WhatsApp client...\n');

  try {
    await client.initialize();
  } catch (e) {
    console.error('❌ Client init error:', e.message);
  }
}

main().catch(console.error);
