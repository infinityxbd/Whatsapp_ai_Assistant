/**
 * Cache Auto-Clean — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 *
 * Two kinds of cleanup live here:
 *   - autoClean()          → SAFE while the browser is running (periodic). Only
 *                            kills orphaned Chrome processes and wipes the
 *                            library media cache (.wwebjs_cache). It NEVER
 *                            touches the live session profile — deleting a
 *                            running browser's Service Worker / Storage folders
 *                            or its SingletonLock is what used to silently put
 *                            the bot "to sleep".
 *   - cleanupForStart()    → FULL cleanup, only safe when NO browser is running
 *                            (process startup / soft restart). Kills every
 *                            leftover Chrome that still holds our session
 *                            profile, removes stale profile locks, and wipes
 *                            all Chrome cache folders (including Service Worker
 *                            and Storage). This is the fix for the classic
 *                            "authenticated but contacts never load" state
 *                            that happens when the new process races the old
 *                            browser for the same .wwebjs_auth profile.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

// Kill EVERY Chrome/Chromium process that is either (a) using OUR session
// profile (.wwebjs_auth in its command line) or (b) orphaned (ppid === 1).
// Used ONLY at process startup / soft restart, when the old browser must be
// fully dead so the new one can take over the profile lock. On a dedicated
// bot VPS this never touches any other application's browser.
function killBotChrome() {
  let killed = 0;
  try {
    const out = execSync(
      "ps -eo pid=,ppid=,args= | grep -iE 'chrom(e|ium)' | grep -v grep || true",
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const pid = parseInt(parts[0]);
      const ppid = parseInt(parts[1]);
      const args = parts.slice(2).join(' ');
      if (pid && (args.includes('wwebjs_auth') || ppid === 1)) {
        try { process.kill(pid, 'SIGKILL'); killed++; } catch (e) {}
      }
    }
  } catch (e) {}

  // Fallback for any helper process the ps pass could not match by command
  // line (e.g. renderers that don't carry --user-data-dir): kill by exact
  // process name. Safe on a bot-only VPS.
  if (killed === 0) {
    try {
      execSync(
        "pkill -9 -x chrome 2>/dev/null; pkill -9 -x chromium 2>/dev/null; pkill -9 -x chromium-browser 2>/dev/null; true",
        { stdio: 'ignore' }
      );
    } catch (e) {}
  }

  if (killed) console.log(`🧹 Killed ${killed} leftover Chrome process(es)`);
  return killed;
}

// Remove stale Chrome profile lock files. Only call when no browser is using
// the profile (startup / restart) — otherwise a second browser could launch
// on the same profile and corrupt it.
function removeStaleLocks() {
  const sessionDir = path.join(BASE_DIR, '.wwebjs_auth', 'session');
  if (!fs.existsSync(sessionDir)) return;

  const lockNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const lf of lockNames) {
    try { fs.unlinkSync(path.join(sessionDir, lf)); } catch (e) {}
  }

  const defaultDir = path.join(sessionDir, 'Default');
  if (fs.existsSync(defaultDir)) {
    try {
      const lockFiles = fs.readdirSync(defaultDir).filter(f => f.endsWith('.lock') || f === 'LOCK' || f === 'lockfile');
      for (const lf of lockFiles) {
        try { fs.unlinkSync(path.join(defaultDir, lf)); } catch (e) {}
      }
    } catch (e) {}
  }
}

function wipeLibraryCache() {
  const cacheDir = path.join(BASE_DIR, '.wwebjs_cache');
  if (fs.existsSync(cacheDir)) {
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (e) {}
  }
}

// Wipe Chrome profile cache folders inside the session (keeps WhatsApp login
// data). `deep=true` also wipes Service Worker + Storage — only safe when no
// browser is running against this profile.
function wipeSessionCaches(deep) {
  const sessionDir = path.join(BASE_DIR, '.wwebjs_auth', 'session');
  if (!fs.existsSync(sessionDir)) return;

  const cacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'Blob_storage'];
  if (deep) cacheFolders.push('Service Worker');
  for (const folder of cacheFolders) {
    const fp = path.join(sessionDir, folder);
    if (fs.existsSync(fp)) {
      try { fs.rmSync(fp, { recursive: true, force: true }); } catch (e) {}
    }
  }

  const defaultDir = path.join(sessionDir, 'Default');
  if (fs.existsSync(defaultDir)) {
    const defaultCacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'Blob_storage'];
    if (deep) defaultCacheFolders.push('Service Worker', 'Storage');
    for (const folder of defaultCacheFolders) {
      const fp = path.join(defaultDir, folder);
      if (fs.existsSync(fp)) {
        try { fs.rmSync(fp, { recursive: true, force: true }); } catch (e) {}
      }
    }
  }
}

// Wipe the session's IndexedDB. The WhatsApp web app keeps its user-prefs
// store ("allUserPrefsIdb") here. An unclean Chrome kill (SIGKILL from the
// watchdog / auto-restart while the browser is writing) can corrupt it, after
// which web.whatsapp.com crashes at boot with "Invariant Violation: Minified
// invariant #56367" inside getUserPrefsTable/allUserPrefsIdb. The crash takes
// the whole page down, so AuthStore is never injected and pairing fails with
// "Cannot read properties of undefined (reading 'PairingCodeLinkUtils')" and
// "Target closed". The app rebuilds this store from scratch on next boot.
// Only safe when NO browser is running against the profile.
function wipeSessionIdb() {
  const sessionDir = path.join(BASE_DIR, '.wwebjs_auth', 'session');
  const idb = path.join(sessionDir, 'Default', 'IndexedDB');
  if (fs.existsSync(idb)) {
    try { fs.rmSync(idb, { recursive: true, force: true }); } catch (e) {}
    return true;
  }
  return false;
}

// True when the previous run never reached online — the session profile may
// hold a corrupt WhatsApp IndexedDB. Reads the same restart_stats.json the
// watchdog writes (fails is incremented before every auto soft-restart and
// reset to 0 as soon as the bot comes online).
function previousRunFailed() {
  try {
    const stats = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'data', 'restart_stats.json'), 'utf-8'));
    return (stats.fails || 0) >= 1;
  } catch (e) {
    return false;
  }
}

// Periodic auto-clean — safe to run while the bot is LIVE. Only handles the
// library media cache and orphaned Chrome processes. Never touches the running
// browser's profile (no lock deletion, no Service Worker / Storage wipe), so a
// healthy session can never be knocked into "sleep mode" by its own cleaner.
function autoClean() {
  if (!hasCache()) {
    console.log('🧹 No cache found — skipping auto clean');
    return false;
  }

  killStaleChrome();
  wipeLibraryCache();
  console.log('🧹 Library cache cleared');
  return true;
}

// Full startup/restart cleanup — ONLY safe when no browser is running yet.
// Guarantees the old browser is fully dead and the profile is unlocked before
// a new instance launches, which prevents the "authenticated but contacts
// never load / bot never goes online" state after a soft restart.
//
// options.resetStorage — also wipe the session IndexedDB (used before
// re-pairing, so the WhatsApp web app always boots clean). Additionally, a
// recovery-mode IndexedDB wipe runs automatically whenever the previous run
// failed to come online (restart_stats.fails >= 1) — a healthy, online session
// never gets its storage touched.
async function cleanupForStart(options = {}) {
  const killed = killBotChrome();
  if (killed) {
    // Give the processes time to die and release profile locks
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  removeStaleLocks();
  wipeSessionCaches(true);
  wipeLibraryCache();
  if (options.resetStorage === true || previousRunFailed()) {
    if (wipeSessionIdb()) {
      console.log('🧹 Session IndexedDB cleared (recovery — web app crashed on last boot)');
    }
  }
  return true;
}

module.exports = { autoClean, hasCache, killStaleChrome, killBotChrome, cleanupForStart };
