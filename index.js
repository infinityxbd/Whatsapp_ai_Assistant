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
const { autoClean } = require('./src/bot/cache');
const { softRestart } = require('./src/bot/restart');

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

  // ─── Auto soft restart every 1 hour (keeps session + all data) ───
  const autoRestartHours = parseFloat(process.env.AUTO_RESTART_HOURS) || 1;
  const autoRestartInterval = autoRestartHours * 60 * 60 * 1000;
  setInterval(() => {
    if (botState.status !== 'online') return;
    console.log('⏰ Hourly auto soft restart triggered');
    softRestart(client, 'hourly auto-restart');
  }, autoRestartInterval);
  console.log(`⏰ Auto soft restart scheduled every ${autoRestartHours}h`);

  console.log('📱 Starting WhatsApp client...\n');

  try {
    await client.initialize();
  } catch (e) {
    console.error('❌ Client init error:', e.message);
  }
}

main().catch(console.error);
