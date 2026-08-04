/**
 * AI Provider tests — providers/
 * Covers the factory (all types build), the Anthropic endpoint fix
 * (no double /v1/messages), base-provider empty-response handling, and
 * request-template fallbacks.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { createProvider } = require('../src/ai/providers');
const AnthropicProvider = require('../src/ai/providers/anthropic');
const BaseProvider = require('../src/ai/providers/base');
// Use the module instance directly — destructuring the methods would drop the
// `this` binding they need to call `this._ask(...)`.
const aiService = require('../src/ai/service');

const baseCfg = {
  name: 't', endpoint: '', apiKey: 'k', model: 'm',
  maxTokens: 512, temperature: 0.7, systemPrompt: '', customHeaders: {},
  requestTemplate: '', responsePath: '', authType: 'bearer', httpMethod: 'POST'
};

// ─── Factory builds every provider type ───
test('createProvider builds all 7 provider types', () => {
  for (const type of ['openai-compatible', 'openai-official', 'gemini', 'anthropic', '1min-ai', 'custom-rest', 'custom-json']) {
    const p = createProvider({ ...baseCfg, providerType: type });
    assert.ok(p && typeof p.generateReply === 'function', `${type} builds`);
  }
});

test('openai-official defaults the endpoint to api.openai.com/v1', () => {
  const p = createProvider({ ...baseCfg, providerType: 'openai-official' });
  assert.strictEqual(p.endpoint, 'https://api.openai.com/v1');
});

// ─── Anthropic endpoint fix (regression) ───
test('anthropic getEndpoint never double-appends /v1/messages', () => {
  const ep = (endpoint) => new AnthropicProvider({ ...baseCfg, endpoint }).getEndpoint();
  assert.strictEqual(ep(''), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(ep('https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(ep('https://api.anthropic.com/v1/messages'), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(ep('https://api.anthropic.com/v1/messages/'), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(ep('https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(ep('https://proxy.example.com/v1/messages'), 'https://proxy.example.com/v1/messages');
  assert.strictEqual(ep('https://proxy.example.com'), 'https://proxy.example.com/v1/messages');
});

// ─── Base provider: empty response → failure, never success ───
test('base provider returns failure on empty response', async () => {
  class EmptyProvider extends BaseProvider {
    async sendRequest() { return {}; }
    parseResponse() { return null; }
  }
  const p = new EmptyProvider(baseCfg);
  const r = await p.generateReply('hi', []);
  assert.strictEqual(r.success, false);
  assert.ok(r.error);
});

test('base provider buildMessages maps history roles', () => {
  const p = new BaseProvider(baseCfg);
  const msgs = p.buildMessages('hello', [
    { role: 'user', text: 'a' },
    { role: 'model', text: 'b' } // 'model' role must map to assistant
  ]);
  assert.strictEqual(msgs.length, 3);
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[1].role, 'assistant');
  assert.strictEqual(msgs[2].role, 'user');
  assert.strictEqual(msgs[2].content, 'hello');
});

test('resolvePath handles dot and bracket notation', () => {
  const p = new BaseProvider(baseCfg);
  const data = { choices: [{ message: { content: 'hi' } }] };
  assert.strictEqual(p.resolvePath(data, 'choices[0].message.content'), 'hi');
  assert.strictEqual(p.resolvePath(data, 'missing.path'), undefined);
});

// ─── Gemini content builder ───
test('gemini getContents skips system messages, maps model→model', () => {
  const GeminiProvider = require('../src/ai/providers/gemini');
  const p = new GeminiProvider(baseCfg);
  const contents = p.getContents([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'u' },
    { role: 'assistant', content: 'a' }
  ]);
  assert.strictEqual(contents.length, 2);
  assert.strictEqual(contents[0].role, 'user');
  assert.strictEqual(contents[1].role, 'model');
});

// ─── Custom provider auth headers ───
test('custom provider builds auth headers per authType', () => {
  const CustomProvider = require('../src/ai/providers/custom');
  let p = new CustomProvider({ ...baseCfg, authType: 'bearer' });
  assert.strictEqual(p.getHeaders()['Authorization'], 'Bearer k');
  p = new CustomProvider({ ...baseCfg, authType: 'api-key-upper' });
  assert.strictEqual(p.getHeaders()['API-KEY'], 'k');
  p = new CustomProvider({ ...baseCfg, authType: 'x-api-key' });
  assert.strictEqual(p.getHeaders()['x-api-key'], 'k');
  p = new CustomProvider({ ...baseCfg, authType: 'basic' });
  assert.ok(p.getHeaders()['Authorization'].startsWith('Basic '));
});

// ─── AI service decision engine: conservative default without APIs ───
// Backs up and restores data/ai_apis.json so these tests have zero side effects.
const { readJSON, writeJSON } = require('../src/storage/store');
const fs = require('fs');
const path = require('path');
const apiFile = path.join(__dirname, '..', 'data', 'ai_apis.json');
const apiBackup = fs.existsSync(apiFile) ? fs.readFileSync(apiFile, 'utf8') : null;
test.after(() => {
  if (apiBackup !== null) fs.writeFileSync(apiFile, apiBackup);
  else if (fs.existsSync(apiFile)) fs.unlinkSync(apiFile);
});

function withNoApis(fn) {
  return async () => {
    writeJSON('ai_apis.json', []);
    try { await fn(); } finally { /* restored by after() */ }
  };
}

test('classifyGroupMessage defaults to no-reply when no APIs configured', withNoApis(async () => {
  const d = await aiService.classifyGroupMessage({ body: 'kemon aso', botName: 'Test', botNames: ['Test'], history: [], senderId: '1', groupId: 'g' });
  assert.strictEqual(d.shouldReply, false);
  assert.ok(['bot', 'group', 'specific_user', 'unknown'].includes(d.target));
}));

test('extractUserMemory returns null without APIs (no crash)', withNoApis(async () => {
  const r = await aiService.extractUserMemory({ messages: 'User: hi', existingSummary: '(none)' });
  assert.strictEqual(r, null);
}));
