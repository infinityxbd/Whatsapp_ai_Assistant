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

function killStaleChrome() {
  try { require('child_process').execSync('killall -9 chrome chromium chromium-browser 2>/dev/null', { stdio: 'ignore' }); } catch (e) {}
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
