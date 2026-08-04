/**
 * Group Intelligence tests — group-intel.js
 * Covers the classifier signals, strict filler gate, fuzzy bot-name detection,
 * anti-spam helpers, and the self-reference identity rule.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const g = require('../src/bot/group-intel');

// ─── Strict filler gate (regression: uncertain messages must reach the AI) ───
test('isObviousFiller only ignores 100%-obvious filler', () => {
  assert.strictEqual(g.isObviousFiller(''), true);
  assert.strictEqual(g.isObviousFiller('😀'), true);            // emoji-only
  assert.strictEqual(g.isObviousFiller('ok'), true);
  assert.strictEqual(g.isObviousFiller('hmm'), true);
  assert.strictEqual(g.isObviousFiller('ha'), true);
  assert.strictEqual(g.isObviousFiller('ok bhai'), false);      // not in tiny set
  assert.strictEqual(g.isObviousFiller('ki'), false);           // "what?" — must reach AI
  assert.strictEqual(g.isObviousFiller('re'), false);           // casual — must reach AI
  assert.strictEqual(g.isObviousFiller('ja'), false);
  assert.strictEqual(g.isObviousFiller('kemon aso'), false);    // real message
});

// ─── Fuzzy bot-name detection ───
test('hasLikelyBotName catches typos, genitive suffixes, case-insensitively', () => {
  const cfg = { botName: 'Suraiya', botAliases: [] };
  assert.strictEqual(g.hasLikelyBotName('Suraia kemon', cfg), true);   // typo
  assert.strictEqual(g.hasLikelyBotName('Suraiyar ki khobor', cfg), true); // genitive
  assert.strictEqual(g.hasLikelyBotName('suraiya aso', cfg), false);   // exact = hasBotName's job
  assert.strictEqual(g.hasLikelyBotName('Mahdi koi tui', cfg), false); // unrelated name
  // Short names must not fuzzy-match prefixes of real names (Rafi → Rahim)
  const rafi = { botName: 'Rafi', botAliases: [] };
  assert.strictEqual(g.hasLikelyBotName('Rahim koi?', rafi), false);
  assert.strictEqual(g.hasLikelyBotName('Rafiq koi?', rafi), false);
});

test('hasBotName respects word boundaries and symmetric quotes/parens', () => {
  const cfg = { botName: 'Suraiya', botAliases: [] };
  assert.strictEqual(g.hasBotName('Suraiya aso', cfg), true);
  assert.strictEqual(g.hasBotName('@Suraiya help', cfg), true);
  assert.strictEqual(g.hasBotName('"Suraiya" kemon', cfg), true);   // quoted both sides
  assert.strictEqual(g.hasBotName('(Suraiya) kemon', cfg), true);   // parenthesized both sides
  assert.strictEqual(g.hasBotName('-Suraiya-', cfg), true);         // dash both sides
  assert.strictEqual(g.hasBotName('Suraiyar', cfg), false);         // substring ≠ mention
  assert.strictEqual(g.hasBotName('Mahdi koi', cfg), false);
});

// ─── Self-reference identity (corrections must always be addressed) ───
test('isSelfReferenceIdentity detects first-person corrections', () => {
  const cfg = { botName: 'Nahid', botAliases: [] };
  assert.strictEqual(g.isSelfReferenceIdentity('Ami Nahid naki?', cfg), true);
  assert.strictEqual(g.isSelfReferenceIdentity('Ami ki Nahid?', cfg), true);
  assert.strictEqual(g.isSelfReferenceIdentity('Ami Nahid na', cfg), true);
  assert.strictEqual(g.isSelfReferenceIdentity('Amake Nahid vabcho?', cfg), true);
  assert.strictEqual(g.isSelfReferenceIdentity('Nahid koi?', cfg), false); // third person
});

// ─── Classifier targets ───
test('classifyGroupMessage: group-wide questions → group target', async () => {
  const cfg = { botName: 'Suraiya', botAliases: [], botWid: '8801' };
  const client = { getChatById: async () => ({}) };
  const msg = { body: 'Keo aso?', from: '1@g.us', hasQuotedMsg: async () => false };
  const s = await g.classifyGroupMessage(msg, client, { botWid: '8801@c.us' }, cfg, { history: [] });
  assert.strictEqual(s.target, 'group');
  assert.strictEqual(s.intent, 'open_question');
  assert.strictEqual(s.shouldReply, true);
});

test('classifyGroupMessage: specific participant → specific_user, silent', async () => {
  const cfg = { botName: 'Suraiya', botAliases: [] };
  const client = {
    getChatById: async () => ({
      getParticipants: async () => [{ pushname: 'Mahdi' }, { pushname: 'Robin' }]
    })
  };
  const msg = { body: 'Mahdi koi tui', from: '1@g.us', hasQuotedMsg: async () => false };
  const s = await g.classifyGroupMessage(msg, client, { botWid: '8801@c.us' }, cfg, { history: [] });
  assert.strictEqual(s.target, 'specific_user');
  assert.strictEqual(s.shouldReply, false);
});

test('classifyGroupMessage: bot name mention → bot target, always reply', async () => {
  const cfg = { botName: 'Suraiya', botAliases: [] };
  const client = { getChatById: async () => ({}) };
  const msg = { body: 'Suraiya aso', from: '1@g.us', hasQuotedMsg: async () => false };
  const s = await g.classifyGroupMessage(msg, client, { botWid: '8801@c.us' }, cfg, { history: [] });
  assert.strictEqual(s.target, 'bot');
  assert.strictEqual(s.shouldReply, true);
});

test('classifyGroupMessage: unclear message → unknown, no local skip', async () => {
  const cfg = { botName: 'Suraiya', botAliases: [] };
  const client = { getChatById: async () => ({}) };
  const msg = { body: 'kemon aso', from: '1@g.us', hasQuotedMsg: async () => false };
  const s = await g.classifyGroupMessage(msg, client, { botWid: '8801@c.us' }, cfg, { history: [] });
  assert.strictEqual(s.target, 'unknown');
  assert.strictEqual(s.shouldReply, false); // AI decides in the handler tier
});

// ─── Anti-spam helpers ───
test('withinCooldown / markReplied basic behavior', () => {
  const chat = '1@g.us';
  assert.strictEqual(g.withinCooldown(chat, 60), false); // never replied yet
  g.markReplied(chat);
  assert.strictEqual(g.withinCooldown(chat, 60), true);
  assert.strictEqual(g.withinCooldown(chat, 0), false); // 0 = disabled
});

test('withinReplyRate caps per-group replies', () => {
  const chat = '1@g.us';
  // Fresh group with limit 2
  assert.strictEqual(g.withinReplyRate(chat, 2), true);
  g.markReplyTime(chat);
  assert.strictEqual(g.withinReplyRate(chat, 2), true);
  g.markReplyTime(chat);
  assert.strictEqual(g.withinReplyRate(chat, 2), false); // 2 already sent
  assert.strictEqual(g.withinReplyRate(chat, 0), true);  // 0 = unlimited
});

test('isDuplicateReply suppresses repeated text within window', () => {
  const chat = '1@g.us';
  assert.strictEqual(g.isDuplicateReply(chat, 'kemon aso', 120), false);
  g.rememberReply(chat, 'kemon aso');
  assert.strictEqual(g.isDuplicateReply(chat, 'kemon aso', 120), true);
  assert.strictEqual(g.isDuplicateReply(chat, 'valo achi', 120), false);
  assert.strictEqual(g.isDuplicateReply(chat, 'kemon aso', 0), false); // disabled
});

test('isGroupWhitelisted: empty = all, filled = only listed', () => {
  assert.strictEqual(g.isGroupWhitelisted('1@g.us', {}), true);
  assert.strictEqual(g.isGroupWhitelisted('1@g.us', { groupWhitelist: [] }), true);
  assert.strictEqual(g.isGroupWhitelisted('12036311111@g.us', { groupWhitelist: ['12036311111'] }), true);
  assert.strictEqual(g.isGroupWhitelisted('12036399999@g.us', { groupWhitelist: ['12036311111'] }), false);
});

test('activityMultiplier scales participation', () => {
  assert.strictEqual(g.activityMultiplier('low'), 0.5);
  assert.strictEqual(g.activityMultiplier('normal'), 1);
  assert.strictEqual(g.activityMultiplier('high'), 1.5);
});

// ─── Question detection ───
test('isQuestion detects Bangla/English questions', () => {
  assert.strictEqual(g.isQuestion('Keo aso?'), true);
  assert.strictEqual(g.isQuestion('Sobai kemon aso'), true);
  assert.strictEqual(g.isQuestion('Keu jane?'), true);
  assert.strictEqual(g.isQuestion('Why is this?'), true);
  assert.strictEqual(g.isQuestion('Just chatting here'), false);
});

test('buildGroupPrompt includes the self-correction rule', () => {
  const prompt = g.buildGroupPrompt({ botName: 'Nahid' });
  assert.ok(prompt.includes('Ami Nahid naki?'));
  assert.ok(prompt.includes('SHORT (1-2 sentences max)'));
});
