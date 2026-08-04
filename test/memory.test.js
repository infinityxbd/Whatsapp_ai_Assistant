/**
 * User Memory tests — memory/service.js
 * Covers the junk-name guard, Banglish language detection, legacy-profile
 * normalization (no crash), merge-not-overwrite, and the privacy filter.
 *
 * The memory service keeps an in-memory cache, so tests seed via the public
 * API and clean up their TEST* keys in `after`.
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const mem = require('../src/memory/service');

const memFile = path.join(__dirname, '..', 'data', 'memory.json');
const cfgFile = path.join(__dirname, '..', 'data', 'config.json');
let backup = null;
let cfgBackup = null;

try { backup = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf8') : null; } catch (e) {}
try { cfgBackup = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : null; } catch (e) {}

after(() => {
  // Remove every test key from the in-memory cache, then restore the files.
  for (const k of ['TESTLEGACY0001', 'TESTMERGE0001', 'TESTBATCH0001', 'TESTSENS0001', 'TESTJUNK0001', 'TESTLANG0001', 'TESTPERSIST0001', 'TESTINT0001', 'TESTFACT0001', 'TESTINT0002', 'TESTINT0003', 'TESTFACT0002', 'TESTFACT0003', 'TESTFACT0004']) {
    try { mem.deleteProfile(k); } catch (e) {}
  }
  if (backup !== null) fs.writeFileSync(memFile, backup);
  else { try { fs.unlinkSync(memFile); } catch (e) {} }
  if (cfgBackup !== null) fs.writeFileSync(cfgFile, cfgBackup);
  else { try { fs.unlinkSync(cfgFile); } catch (e) {} }
});

// Raise the AI-analysis threshold so no test ever triggers a real AI call.
function silenceAI() {
  fs.writeFileSync(cfgFile, JSON.stringify({ memoryAnalyzeEnabled: true, memoryAnalyzeEvery: 999 }));
}

// Seeds a profile via the public API (works with the in-memory cache).
function makeProfile(key) {
  mem.deleteProfile(key);
  const p = mem.getOrCreateProfile(key, key);
  // Strip the upgraded fields to simulate a legacy saved profile.
  delete p.habits; delete p.interests; delete p.preferences; delete p.facts;
  delete p.notes; delete p.memoryEnabled; delete p.activity;
  delete p.lastAnalyzedAt; delete p.analyzedMessageCount; delete p.messagesSinceAnalyze;
  return p;
}

// ─── Junk-name guard (regression: "ki bolto" must never be a name) ───
test('isValidName rejects questions, filler, digits, punctuation', () => {
  assert.strictEqual(mem.isValidName('ki bolto'), false);
  assert.strictEqual(mem.isValidName('kemon'), false);
  assert.strictEqual(mem.isValidName('12345'), false);
  assert.strictEqual(mem.isValidName('later'), false);
  assert.strictEqual(mem.isValidName('please'), false);
  assert.strictEqual(mem.isValidName('call me later'), false); // multi-word junk
  assert.strictEqual(mem.isValidName('Rahim'), true);
  assert.strictEqual(mem.isValidName('Md Rahim'), true);
  assert.strictEqual(mem.isValidName('rahim'), true);
});

// ─── Language detection (Banglish by writing style, not script) ───
test('detectLanguage classifies Banglish, Bangla, English, Mixed', () => {
  assert.strictEqual(mem.detectLanguage('Ki koros?'), 'bl');
  assert.strictEqual(mem.detectLanguage('Khaichis?'), 'bl');
  assert.strictEqual(mem.detectLanguage('Ajke ki korbi?'), 'bl');
  assert.strictEqual(mem.detectLanguage('Ami valo achi'), 'bl');
  assert.strictEqual(mem.detectLanguage('আমি ভালো আছি'), 'bn');
  assert.strictEqual(mem.detectLanguage('Hello, how are you?'), 'en');
  assert.strictEqual(mem.detectLanguage('Ami আছি'), 'mixed');
});

// ─── Legacy profile normalization (no crash on old saved data) ───
test('legacy profile without new fields is normalized, not crashed', () => {
  const key = 'TESTLEGACY0001';
  makeProfile(key);

  const p = mem.getProfile(key); // must not throw
  assert.ok(Array.isArray(p.habits));
  assert.ok(Array.isArray(p.interests));
  assert.ok(Array.isArray(p.preferences));
  assert.ok(Array.isArray(p.facts));
  assert.strictEqual(typeof p.activity.totalMessages, 'number');
  assert.strictEqual(p.memoryEnabled, true);

  // buildContext (called on EVERY message) must not throw
  assert.strictEqual(typeof mem.buildContext(key, 'chat@g.us'), 'string');
  // updateFromExchange must survive and persist activity
  mem.updateFromExchange(key, key, 'Ki koros?', null, { chatId: 'c@g.us', isGroup: true });
  assert.strictEqual(mem.getProfile(key).activity.totalMessages, 1);
  mem.deleteProfile(key);
});

// ─── Merge: keep existing, add new, never clobber blindly ───
test('mergeMemory keeps existing info and adds new evidence', () => {
  const key = 'TESTMERGE0001';
  makeProfile(key);
  const p = mem.getProfile(key);
  p.language = 'bl';
  p.interests = ['cricket'];

  mem.mergeMemory(p, {
    name: 'Rahim', language: 'banglish', style: 'short replies',
    interests: ['gaming'], preferences: ['Prefers short replies'], facts: [], habits: ['uses emoji']
  });
  assert.strictEqual(p.name, 'Rahim');                 // valid name kept
  assert.strictEqual(p.language, 'bl');                // never downgraded
  assert.ok(p.interests.includes('cricket'));          // existing kept
  assert.ok(p.interests.includes('gaming'));           // new added
  assert.ok(p.habits.includes('uses emoji'));
  mem.deleteProfile(key);
});

test('mergeMemory refuses junk names', () => {
  const key = 'TESTMERGE0001';
  makeProfile(key);
  const p = mem.getProfile(key);
  mem.mergeMemory(p, { name: 'ki bolto', interests: [] });
  assert.strictEqual(p.name, ''); // junk never stored
  mem.deleteProfile(key);
});

// ─── Batching counter — no double-fire / no analysis without provider ───
test('updateFromExchange increments batch counter without analyzing', () => {
  const key = 'TESTBATCH0001';
  mem.deleteProfile(key);
  for (let i = 0; i < 3; i++) {
    mem.updateFromExchange(key, key, 'Ki koros? valo achi', null, { chatId: 'c@g.us', isGroup: true });
  }
  const p = mem.getProfile(key);
  assert.ok(p.messagesSinceAnalyze > 0, 'counter increments');
  assert.ok(!p.lastAnalyzedAt, 'no analysis ran (no AI provider in tests)');
  mem.deleteProfile(key);
});

// ─── Short-term privacy filter ───
test('sensitive content is never stored', () => {
  const key = 'TESTSENS0001';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'my otp is 123456', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'card 1234 5678 9012 3456', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(!p || p.activity.totalMessages === 0, 'sensitive messages skipped');
  mem.deleteProfile(key);
});

// ─── Junk-name repair on load (regression: old "ki bolto" data) ───
test('stored junk names are repaired on load without AI', () => {
  const key = 'TESTJUNK0001';
  mem.deleteProfile(key);
  const p = mem.getOrCreateProfile(key, key);
  p.name = 'ki bolto'; // junk stored by an older bot version
  const repaired = mem.getProfile(key); // normalizeProfile runs on every read
  assert.strictEqual(repaired.name, '', 'junk name cleared on load');
  mem.deleteProfile(key);
});

// ─── Language majority vote (no last-message flips) ───
test('language uses majority vote — one Bangla message does not flip Banglish', () => {
  silenceAI();
  const key = 'TESTLANG0001';
  mem.deleteProfile(key);
  // 4 Banglish messages, then 1 Bangla-script message.
  const msgs = ['Ki koros?', 'Ajke ki korbi?', 'Khaichis?', 'Valo achi', 'আমি ভালো আছি'];
  for (const m of msgs) {
    mem.updateFromExchange(key, key, m, null, { chatId: 'c@g.us', isGroup: true });
  }
  assert.strictEqual(mem.getProfile(key).language, 'bl', 'Banglish majority wins');
  mem.deleteProfile(key);
});

test('language fills Banglish when majority is Banglish even if a Bangla message came first', () => {
  silenceAI();
  const key = 'TESTLANG0002';
  mem.deleteProfile(key);
  const msgs = ['আমি ভালো আছি', 'Ki koros?', 'Ajke ki korbi?', 'Khaichis?', 'Valo achi'];
  for (const m of msgs) {
    mem.updateFromExchange(key, key, m, null, { chatId: 'c@g.us', isGroup: true });
  }
  assert.strictEqual(mem.getProfile(key).language, 'bl', 'majority Banglish wins over first message');
  mem.deleteProfile(key);
});

// ─── Banglish heuristic extraction (fills interests/facts without AI) ───
test('Banglish interests are extracted without AI', () => {
  silenceAI();
  const key = 'TESTINT0001';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'ami cricket khelte bhalobashi', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'ami game khelte valo lage', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(p.interests.includes('cricket'), 'cricket extracted');
  assert.ok(p.interests.includes('game'), 'game extracted');
  // no junk like "cricket khelte" or "ar kichu"
  assert.ok(!p.interests.some(i => /khelte|valo lage/.test(i)), 'no verb junk stored');
  mem.deleteProfile(key);
});

test('Banglish facts are extracted without AI', () => {
  silenceAI();
  const key = 'TESTFACT0001';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'ami Dhaka theke ashi', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'amar boyos 21', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(p.facts.some(f => f.toLowerCase().includes('dhaka')), 'origin extracted');
  assert.ok(p.facts.some(f => f.includes('21 years old')), 'age extracted');
  mem.deleteProfile(key);
});

test('junk phrases are not stored as interests or facts', () => {
  silenceAI();
  const key = 'TESTINT0002';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'ar kichu khelte bhalobashi na', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'ami ar valo lage', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(p.interests.length === 0 || !p.interests.some(i => /^ar\s|kichu/.test(i)), 'no filler interest');
  mem.deleteProfile(key);
});

test('question words never become interests', () => {
  silenceAI();
  const key = 'TESTINT0003';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'ami kokhon khelte bhalobashi?', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'ami keno khelte bhalobashi?', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(!p.interests.some(i => /^(kokhon|keno|kon|ki|naki)\b/.test(i)), 'no question-word interest');
  mem.deleteProfile(key);
});

test('duration phrases never become age facts', () => {
  silenceAI();
  const key = 'TESTFACT0002';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'ami 2 bosor dhore khelchi', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'ami 5 bosor age chilo', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(!p.facts.some(f => /years old/.test(f)), 'duration is not stored as age');
  mem.deleteProfile(key);
});

test('Lives in fact extracted from Banglish', () => {
  silenceAI();
  const key = 'TESTFACT0003';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'ami Chittagong e thaki', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(p.facts.some(f => f.toLowerCase().includes('chittagong')), 'residence extracted');
  mem.deleteProfile(key);
});

test('transient locations are never stored as facts', () => {
  silenceAI();
  const key = 'TESTFACT0004';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'ami kaj theke ashi', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'ami office theke ashi', null, { chatId: 'c@g.us', isGroup: true });
  mem.updateFromExchange(key, key, 'ami bus e thaki', null, { chatId: 'c@g.us', isGroup: true });
  const p = mem.getProfile(key);
  assert.ok(!p.facts.some(f => /kaj|office|bus/i.test(f)), 'no transient-location fact');
  mem.deleteProfile(key);
});

// ─── Short-term persistence across restart (core fix) ───
test('short-term buffer persists to disk and restores on reload', () => {
  const key = 'TESTPERSIST0001';
  mem.deleteProfile(key);
  mem.updateFromExchange(key, key, 'Ki koros?', 'bhalo achi', { chatId: 'a@g.us', isGroup: true });
  mem.persist();

  // The message must be on disk (survives the hourly soft restart).
  const saved = JSON.parse(fs.readFileSync(memFile, 'utf8'));
  assert.ok(saved.shortTerm && Array.isArray(saved.shortTerm[key]), 'short-term written to disk');

  // Simulate a restart: bust the module cache and re-require.
  const memPath = require.resolve('../src/memory/service');
  delete require.cache[memPath];
  const mem2 = require('../src/memory/service');

  // buildContext(key, otherChatId) surfaces cross-chat recent messages —
  // which only works if the short-term buffer was restored from disk.
  const ctx = mem2.buildContext(key, 'b@g.us');
  assert.ok(ctx.includes('Ki koros?'), 'short-term restored after simulated restart');

  // Clean BOTH module instances so a stale exit-time persist from the
  // reloaded instance can never re-dirty the file (the debounced save timer
  // and process-exit handlers write the in-memory cache to disk).
  for (const k of ['TESTLEGACY0001', 'TESTMERGE0001', 'TESTBATCH0001', 'TESTSENS0001', 'TESTJUNK0001', 'TESTLANG0001', 'TESTPERSIST0001', 'TESTINT0001', 'TESTFACT0001', 'TESTINT0002', 'TESTINT0003', 'TESTFACT0002', 'TESTFACT0003', 'TESTFACT0004']) {
    try { mem2.deleteProfile(k); } catch (e) {}
  }
  mem2.persist();
});
