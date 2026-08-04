/**
 * Cache Auto-Clean — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', '..');

// Returns true only if some cache actually exists to clean
// (.wwebjs_cache dir or any Chrome profile cache folder).
function hasCache() {
  if (fs.existsSync(path.join(BASE_DIR, '.wwebjs_cache'))) return true;

  const sessionDir = path.join(BASE_DIR, '.wwebjs_auth', 'session');
  if (!fs.existsSync(sessionDir)) return false;

  const cacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Blob_storage'];
  for (const folder of cacheFolders) {
    if (fs.existsSync(path.join(sessionDir, folder))) return true;
  }

  const defaultDir = path.join(sessionDir, 'Default');
  if (fs.existsSync(defaultDir)) {
    const defaultCacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Blob_storage', 'Storage'];
    for (const folder of defaultCacheFolders) {
      if (fs.existsSync(path.join(defaultDir, folder))) return true;
    }
  }

  return false;
}

// Kill ONLY orphaned Chrome processes (parent = init/1, i.e. left behind by a
// previously crashed or killed bot). NEVER kills this bot's own browser —
// killing the live browser every 15 min is what used to silently put the bot
// "to sleep".
function killStaleChrome() {
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      "ps -eo pid=,ppid=,comm= | grep -E 'chrome|chromium' | grep -v grep || true",
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const killed = [];
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const pid = parseInt(parts[0]);
      const ppid = parseInt(parts[1]);
      // ppid === 1 means the parent process is gone → safe to clean up
      if (pid && ppid === 1) {
        try { process.kill(pid, 'SIGKILL'); killed.push(pid); } catch (e) {}
      }
    }
    if (killed.length) console.log(`🧹 Killed ${killed.length} orphaned chrome process(es)`);
  } catch (e) {}
}

// Auto clean only runs when there is actually a cache to clean. If no cache
// exists it does nothing (no chrome kill, no folder wipes).
function autoClean() {
  if (!hasCache()) {
    console.log('🧹 No cache found — skipping auto clean');
    return false;
  }

  killStaleChrome();

  // Wipe .wwebjs_cache entirely
  const cacheDir = path.join(BASE_DIR, '.wwebjs_cache');
  if (fs.existsSync(cacheDir)) {
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (e) {}
  }

  // Wipe Chrome profile cache inside session (keep WhatsApp login data)
  const sessionDir = path.join(BASE_DIR, '.wwebjs_auth', 'session');
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
  return true;
}

module.exports = { autoClean, hasCache, killStaleChrome };
