/**
 * Soft Restart — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { cleanupForStart } = require('./cache');

const STATS_FILE = path.join(__dirname, '..', '..', 'data', 'restart_stats.json');

// ─── Restart stats ───
// Persisted across restarts so a genuinely broken session (e.g. logged out on
// the phone) can never cause an endless auto-restart loop. The counter resets
// as soon as the bot successfully reaches the online state.
function readRestartStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8')) || {};
  } catch (e) {
    return {};
  }
}

function writeRestartStats(stats) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {}
}

// Call before every auto soft-restart. Returns the number of consecutive
// restarts that failed to bring the bot back online (capped at 3).
function recordRestartAttempt() {
  const stats = readRestartStats();
  stats.fails = (stats.fails || 0) + 1;
  stats.lastAttempt = Date.now();
  writeRestartStats(stats);
  return stats.fails;
}

// Call when the bot reaches the online state — clears the failure counter.
function markBotOnline() {
  const stats = readRestartStats();
  if (stats.fails || stats.lastAttempt) {
    stats.fails = 0;
    stats.lastOnline = Date.now();
    writeRestartStats(stats);
  }
}

// True when the session has already failed 3 consecutive restarts — we stop
// auto-restarting and wait for manual action (the admin panel shows the QR).
function autoRestartBlocked() {
  const stats = readRestartStats();
  return (stats.fails || 0) >= 3;
}

// Soft restart: gracefully destroy the WhatsApp client, make sure the old
// browser is fully dead and has released the .wwebjs_auth profile lock, spawn
// a fresh bot process and exit. Session data, API keys and all data files are
// kept — nothing is lost.
//
// The critical part is that we WAIT for the old browser to actually die and
// clean its profile lock BEFORE the new process launches. Without this, the
// new process races the old Chrome for the same profile directory, which shows
// up as "WhatsApp authenticated but contacts never load / bot never goes
// online" — exactly the "sleep mode" after a soft restart.
function softRestart(client, source) {
  console.log('🔄 Soft restart triggered' + (source ? ' — ' + source : ''));
  setTimeout(() => {
    (async () => {
      // 1) Ask the client to close its browser gracefully (time-boxed so a
      //    hung browser can never block the restart forever).
      if (client) {
        try {
          await Promise.race([
            client.destroy(),
            new Promise((resolve) => setTimeout(resolve, 8000))
          ]);
        } catch (e) {}
      }

      // 2) Kill any leftover Chrome still holding our session profile and
      //    remove stale locks/caches (safe — no browser is running anymore).
      try { await cleanupForStart(); } catch (e) {}

      // 3) Launch the fresh bot process and exit this one. Output is appended
      //    to bot.log so logs survive the restart and stay debuggable.
      const cwd = path.join(__dirname, '..', '..');
      const logFd = fs.openSync(path.join(cwd, 'bot.log'), 'a');
      const child = spawn('node', ['index.js'], { detached: true, stdio: ['ignore', logFd, logFd], cwd });
      child.unref();
      process.exit(0);
    })().catch((e) => {
      console.error('❌ Soft restart error:', e.message);
      process.exit(1);
    });
  }, 300);
}

module.exports = { softRestart, recordRestartAttempt, markBotOnline, autoRestartBlocked };
