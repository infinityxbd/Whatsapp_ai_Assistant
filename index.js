/**
 * WhatsApp AI Auto-Reply Bot
 * Developer: Tarif Ahmed (infinityX)
 * Co-Founder, Senior Admin @ Student Cyber Expert Force (SCEF)
 * Telegram: https://t.me/infinityxbd
 */
// Use Bangladeshi local time (UTC+6) for ALL log timestamps, regardless of
// the server's own timezone.
process.env.TZ = 'Asia/Dhaka';

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
const { cleanupForStart } = require('./src/bot/cache');
const { softRestart, recordRestartAttempt } = require('./src/bot/restart');

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
      botAliases: '',
      botEnabled: true,
      // Group Conversation Intelligence defaults
      groupPrompt: '',
      groupReplyChance: 0.25,
      groupCooldownSec: 45,
      reactionsEnabled: true,
      reactionChance: 0.12,
      replyToReactions: false,
      reactionReplyChance: 0.2,
      questionBoostChance: 0.6,
      groupSettings: {},
      // Hybrid AI decision flow defaults
      groupAiEnabled: true,
      contextMessageLimit: 5,
      replyActivity: 'normal',
      groupWhitelist: [],
      maxRepliesPerMinute: 4,
      duplicateReplySec: 120,
      debugDecisionLogs: false,
      // AI User Memory analysis defaults
      memoryAnalyzeEnabled: true,
      memoryAnalyzeEvery: 20
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
  // Full startup cleanup: kill any leftover Chrome from a previous instance,
  // unlock the session profile and wipe stale caches BEFORE the browser
  // launches. This is what prevents the "authenticated but contacts never
  // load / bot never goes online" state after a soft restart.
  try { await cleanupForStart(); } catch (e) {}

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

  // ─── Full restart every N hours (default 4h) — the ONLY auto-restart ───
  // The old hourly auto soft-restart and the 24/7 watchdog auto-restarts are
  // disabled — they kept interrupting the session. Instead the bot simply
  // stops and starts again on a fixed schedule: session data is kept, Chrome
  // is killed and relaunched fresh, so a long-running bot gets a clean slate
  // every few hours without constant small restarts.
  // A scheduled restart only counts as a "failed cycle" (which triggers the
  // recovery IndexedDB wipe on the next boot) when the bot was OFFLINE at the
  // time — a healthy online bot restarts without touching its session at all.
  const restartIntervalHours = parseFloat(process.env.RESTART_INTERVAL_HOURS) || 4;
  const restartInterval = restartIntervalHours * 60 * 60 * 1000;
  const HEALTHY_RECENT_MS = 30 * 60 * 1000; // online within the last 30 min = healthy
  setInterval(() => {
    const healthyRecently = botState.lastOnline && (Date.now() - botState.lastOnline) < HEALTHY_RECENT_MS;
    if (botState.status !== 'online' && !healthyRecently) {
      recordRestartAttempt();
    }
    console.log(`⏰ Scheduled full restart (every ${restartIntervalHours}h)`);
    softRestart(client, 'scheduled full restart');
  }, restartInterval);
  console.log(`⏰ Auto-restarts disabled — full restart every ${restartIntervalHours}h`);

  // ─── User Memory System: prune inactive profiles daily ───
  setInterval(() => {
    try { require('./src/memory/service').prune(); } catch (e) {}
  }, 24 * 60 * 60 * 1000);
  console.log('🧠 User Memory System active (daily prune enabled)');

  console.log('📱 Starting WhatsApp client...\n');

  const { safeInitialize } = require('./src/bot/whatsapp');
  await safeInitialize();
}

main().catch(console.error);
