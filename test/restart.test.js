/**
 * Restart & cache cleanup tests
 * Exercises the REAL restart-stats helpers (src/bot/restart.js) and cache
 * cleanup helpers (src/bot/cache.js) so the "24/7 online / soft restart"
 * guarantees can't silently regress.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '..', 'data', 'restart_stats.json');
const { recordRestartAttempt, markBotOnline, autoRestartBlocked } = require('../src/bot/restart');
const { autoClean, hasCache, killBotChrome, killStaleChrome, cleanupForStart } = require('../src/bot/cache');

function resetStats() {
  try { fs.unlinkSync(STATS_FILE); } catch (e) {}
}

test('restart stats: 3 failed attempts block auto-restart, online resets it', () => {
  resetStats();
  try {
    assert.strictEqual(autoRestartBlocked(), false, 'no attempts yet → not blocked');
    recordRestartAttempt();
    assert.strictEqual(autoRestartBlocked(), false);
    recordRestartAttempt();
    assert.strictEqual(autoRestartBlocked(), false);
    recordRestartAttempt();
    assert.strictEqual(autoRestartBlocked(), true, '3 failures → blocked');

    markBotOnline();
    assert.strictEqual(autoRestartBlocked(), false, 'successful online clears the counter');
  } finally {
    resetStats();
  }
});

test('restart stats file round-trips through disk', () => {
  resetStats();
  try {
    recordRestartAttempt();
    const onDisk = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    assert.strictEqual(onDisk.fails, 1, 'attempt count persisted');
    assert.ok(onDisk.lastAttempt, 'last attempt timestamp persisted');
  } finally {
    resetStats();
  }
});

test('killBotChrome never throws and returns a count', async () => {
  const killed = killBotChrome();
  assert.strictEqual(typeof killed, 'number');
  assert.ok(killed >= 0);
});

test('killStaleChrome never throws', () => {
  killStaleChrome();
  assert.ok(true);
});

test('cleanupForStart completes without a browser present', async () => {
  const result = await cleanupForStart();
  assert.strictEqual(result, true);
});

test('autoClean returns false when there is nothing to clean', () => {
  if (!hasCache()) {
    assert.strictEqual(autoClean(), false);
  } else {
    assert.strictEqual(autoClean(), true);
  }
});
