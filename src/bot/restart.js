/**
 * Soft Restart — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { spawn } = require('child_process');
const path = require('path');

// Soft restart: gracefully destroy the WhatsApp client, spawn a fresh bot
// process and exit. Session data, API keys and all data files are kept —
// nothing is lost.
function softRestart(client, source) {
  console.log('🔄 Soft restart triggered' + (source ? ' — ' + source : ''));
  setTimeout(() => {
    try { if (client) client.destroy(); } catch (e) {}
    const cwd = path.join(__dirname, '..', '..');
    const child = spawn('node', ['index.js'], { detached: true, stdio: 'ignore', cwd });
    child.unref();
    process.exit(0);
  }, 800);
}

module.exports = { softRestart };
