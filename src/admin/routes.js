/**
 * Admin Routes — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { readJSON, writeJSON } = require('../storage/store');
const { requireAuth } = require('./middleware');

// ─── Live Log System ───
const logBuffer = [];
const MAX_LOGS = 100;
const sseClients = new Set();
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const fs = require('fs');
const logFilePath = require('path').join(__dirname, '..', '..', 'bot.log');
const LOG_WRITE_FLAGS = { flag: 'a' };

function broadcastLog(level, args) {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const entry = { time, level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach(res => { try { res.write(data); } catch (e) {} });
  // Write to log file for /log command
  try { fs.writeFileSync(logFilePath, `${time} [${level}] ${msg}\n`, LOG_WRITE_FLAGS); } catch (e) {}
}

console.log = (...args) => { originalLog.apply(console, args); broadcastLog('info', args); };
console.error = (...args) => { originalError.apply(console, args); broadcastLog('error', args); };
console.warn = (...args) => { originalWarn.apply(console, args); broadcastLog('warn', args); };

// ─── Auto-Update System ───
let autoUpdateTimer = null;

function startAutoUpdate() {
  stopAutoUpdate();
  const config = readJSON('config.json') || {};
  if (!config.autoUpdate) return;
  const interval = (config.autoUpdateInterval || 30) * 60 * 1000;
  autoUpdateTimer = setInterval(async () => {
    try {
      const cwd = path.join(__dirname, '..', '..');
      const current = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
      execSync('git fetch origin main', { cwd, timeout: 15000 });
      const latest = execSync('git rev-parse origin/main', { cwd, encoding: 'utf-8' }).trim();
      if (current !== latest) {
        console.log('🔄 Auto-update: new version detected, updating...');
        execSync('git pull origin main', { cwd });
        execSync('npm install --production', { cwd, timeout: 60000 });
        console.log('✅ Auto-update complete. Restarting...');
        const child = spawn('node', ['index.js'], { detached: true, stdio: 'ignore', cwd });
        child.unref();
        process.exit(0);
      }
    } catch (e) {
      console.log('🔄 Auto-update check: ' + e.message);
    }
  }, interval);
}

function stopAutoUpdate() {
  if (autoUpdateTimer) { clearInterval(autoUpdateTimer); autoUpdateTimer = null; }
}

function createRoutes(botState, client) {
  const router = express.Router();

  router.use(requireAuth);

  // Serve login page (no auth required for GET)
  router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/login.html'));
  });

  // Serve dashboard (auth required via middleware)
  router.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/dashboard.html'));
  });

  // Auth routes
  router.post('/login', async (req, res) => {
    const { password } = req.body;
    const config = readJSON('config.json') || {};

    if (!config.adminPasswordHash) {
      return res.redirect('/admin/login?error=1');
    }

    const match = await bcrypt.compare(password, config.adminPasswordHash);
    if (match) {
      req.session.authenticated = true;
      return res.redirect('/admin/dashboard');
    }
    res.redirect('/admin/login?error=1');
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  });

  // API: Status
  router.get('/api/status', (req, res) => {
    const uptime = botState.startTime ? Math.floor((Date.now() - botState.startTime) / 1000) : 0;
    res.json({
      status: botState.status,
      uptime,
      startTime: botState.startTime
    });
  });

  // API: Settings
  router.get('/api/settings', (req, res) => {
    const config = readJSON('config.json') || {};
    res.json({
      botPrompt: config.botPrompt || '',
      replyToInbox: config.replyToInbox !== false,
      replyToGroups: config.replyToGroups === true,
      botName: config.botName || 'AI Assistant',
      botEnabled: config.botEnabled !== false
    });
  });

  router.post('/api/settings', (req, res) => {
    const { botPrompt, replyToInbox, replyToGroups, botName, botEnabled } = req.body;
    const config = readJSON('config.json') || {};

    if (typeof botPrompt === 'string') config.botPrompt = botPrompt;
    if (typeof replyToInbox === 'boolean') config.replyToInbox = replyToInbox;
    if (typeof replyToGroups === 'boolean') config.replyToGroups = replyToGroups;
    if (typeof botName === 'string') config.botName = botName;

    writeJSON('config.json', config);
    res.json({ success: true });
  });

  // API: Bot On/Off Toggle
  router.get('/api/bot-toggle', (req, res) => {
    const config = readJSON('config.json') || {};
    res.json({ enabled: config.botEnabled !== false });
  });

  router.post('/api/bot-toggle', async (req, res) => {
    const { enabled } = req.body;
    const config = readJSON('config.json') || {};
    config.botEnabled = enabled;
    writeJSON('config.json', config);

    try {
      if (client) {
        if (enabled) {
          await client.sendPresenceAvailable();
          console.log('🟢 Bot enabled via admin panel - presence ONLINE');
        } else {
          await client.sendPresenceUnavailable();
          console.log('🔴 Bot disabled via admin panel - presence OFFLINE');
        }
      }
    } catch (e) {
      console.error('⚠️ Failed to toggle presence:', e.message);
    }

    res.json({ success: true, enabled });
  });

  // API: Keys
  router.get('/api/keys', (req, res) => {
    const keys = readJSON('apikeys.json') || [];
    const masked = keys.map(k => ({
      ...k,
      apiKey: '••••••••••••' + k.apiKey.slice(-4)
    }));
    res.json(masked);
  });

  router.post('/api/keys', (req, res) => {
    const { name, apiKey, endpoint, model } = req.body;
    if (!name || !apiKey) {
      return res.status(400).json({ error: 'Name and API key are required' });
    }

    const keys = readJSON('apikeys.json') || [];
    const newKey = {
      id: uuidv4(),
      name,
      apiKey,
      endpoint: endpoint || 'https://generativelanguage.googleapis.com',
      model: model || 'gemini-1.5-flash',
      enabled: true,
      addedAt: new Date().toISOString()
    };
    keys.push(newKey);
    writeJSON('apikeys.json', keys);
    res.json({ success: true, id: newKey.id });
  });

  router.delete('/api/keys/:id', (req, res) => {
    let keys = readJSON('apikeys.json') || [];
    keys = keys.filter(k => k.id !== req.params.id);
    writeJSON('apikeys.json', keys);
    res.json({ success: true });
  });

  router.patch('/api/keys/:id', (req, res) => {
    const keys = readJSON('apikeys.json') || [];
    const key = keys.find(k => k.id === req.params.id);
    if (!key) return res.status(404).json({ error: 'Key not found' });
    key.enabled = req.body.enabled !== undefined ? req.body.enabled : !key.enabled;
    writeJSON('apikeys.json', keys);
    res.json({ success: true, enabled: key.enabled });
  });

  // API: Check API key health
  router.get('/api/keys/check', async (req, res) => {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const keys = readJSON('apikeys.json') || [];
    const results = [];

    for (const key of keys) {
      try {
        const genAI = new GoogleGenerativeAI(key.apiKey);
        const model = genAI.getGenerativeModel({ model: key.model || 'gemini-2.0-flash-lite' });
        await model.generateContent('hi');
        results.push({ id: key.id, status: 'ok', error: null });
      } catch (e) {
        const errMsg = e.message || 'Unknown error';
        let friendly = 'Unknown error';
        if (errMsg.includes('429')) friendly = 'Rate limited / Quota exceeded';
        else if (errMsg.includes('403')) friendly = 'Invalid API key / Access denied';
        else if (errMsg.includes('404')) friendly = 'Model not found';
        else if (errMsg.includes('fetch')) friendly = 'Network error';
        else friendly = errMsg.substring(0, 80);
        results.push({ id: key.id, status: 'error', error: friendly });
      }
    }

    const keyStatusPath = require('path').join(__dirname, '../../data/keystatus.json');
    require('fs').writeFileSync(keyStatusPath, JSON.stringify(results, null, 2));
    res.json(results);
  });

  // API: Contacts (for blocklist search)
  router.get('/api/contacts', (req, res) => {
    try {
      if (client && client.info && client.contacts) {
        const contacts = client.contacts.map(c => ({
          id: c.id._serialized || c.id,
          name: c.name || c.pushname || c.id.user || 'Unknown',
          number: c.id.user || c.id
        }));
        res.json(contacts);
      } else {
        res.json([]);
      }
    } catch (e) {
      res.json([]);
    }
  });

  // API: WhatsApp Login / Pairing
  router.get('/api/whatsapp/status', (req, res) => {
    const connected = botState.status === 'online';
    let info = null;
    try { info = client ? client.info : null; } catch (e) {}
    res.json({ connected, info: info || null });
  });

  router.post('/api/whatsapp/pair', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const cleanNumber = phoneNumber.trim().replace(/\D/g, '');
    if (cleanNumber.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // If client page is closed or crashed, reinit first
    const pageClosed = !client.pupPage || client.pupPage.isClosed();
    if (pageClosed) {
      console.log('🔄 Client page closed — reinitializing...');
      try { await client.destroy(); } catch (e) {}
      botState.status = 'offline';
      await new Promise(r => setTimeout(r, 2000));
      try { await client.initialize(); } catch (e) {
        return res.status(500).json({ error: 'Failed to restart client: ' + e.message });
      }
    }

    // Wait up to 20s for client to be ready
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (client && client.pupPage && !client.pupPage.isClosed()) {
        ready = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!ready) {
      return res.status(500).json({ error: 'Client not ready. Wait a moment and try again.' });
    }

    // Extra wait for page to stabilize
    await new Promise(r => setTimeout(r, 2000));

    try {
      const code = await client.requestPairingCode(cleanNumber);
      const formatted = code.match(/.{1,4}/g).join('-');
      console.log(`🔑 Pairing code requested for ${cleanNumber}: ${formatted}`);
      res.json({ success: true, code: formatted });
    } catch (e) {
      console.error('❌ Pairing failed:', e.message || e);
      res.status(500).json({ error: e.message || 'Pairing failed. Try again.' });
    }
  });

  router.post('/api/whatsapp/logout', async (req, res) => {
    // Wipe session data
    const fs = require('fs');
    const path = require('path');
    const sessionDir = path.join(__dirname, '../../.wwebjs_auth');
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('🧹 Session data wiped');
      }
    } catch (e) {}

    res.json({ success: true });
    console.log('🔴 WhatsApp logout from admin panel');

    // Try clean logout — if it fails, force destroy to trigger disconnected event
    try {
      await client.logout();
    } catch (e) {
      console.log('⚠️ logout failed, forcing destroy...');
      try { await client.destroy(); } catch (e2) {}
      // disconnected event should fire from destroy
    }
  });

  router.post('/api/whatsapp/restart', async (req, res) => {
    try {
      try { await client.destroy(); } catch (e) {}
      botState.status = 'offline';
      await new Promise(r => setTimeout(r, 2000));
      await client.initialize();
      console.log('🔄 WhatsApp client restarted');
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // API: Blocklist
  router.get('/api/blocklist', (req, res) => {
    const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
    res.json(blocklist);
  });

  router.post('/api/blocklist', (req, res) => {
    const { type, value } = req.body;
    const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };

    if (type === 'number') {
      let num = value.trim();
      if (!num.endsWith('@c.us')) num += '@c.us';
      if (!blocklist.numbers.includes(num)) blocklist.numbers.push(num);
    } else if (type === 'group') {
      if (!blocklist.groups.includes(value)) blocklist.groups.push(value);
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    writeJSON('blocklist.json', blocklist);
    res.json({ success: true });
  });

  router.delete('/api/blocklist/:type/:encodedId', (req, res) => {
    const { type, encodedId } = req.params;
    const id = decodeURIComponent(encodedId);
    const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };

    if (type === 'number') {
      blocklist.numbers = blocklist.numbers.filter(n => n !== id);
    } else if (type === 'group') {
      blocklist.groups = blocklist.groups.filter(g => g !== id);
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    writeJSON('blocklist.json', blocklist);
    res.json({ success: true });
  });

  // API: Change Password
  router.post('/api/change-password', async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const config = readJSON('config.json') || {};

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }

    if (!config.adminPasswordHash) {
      return res.status(400).json({ error: 'No password set' });
    }

    const match = await bcrypt.compare(currentPassword, config.adminPasswordHash);
    if (!match) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    config.adminPasswordHash = await bcrypt.hash(newPassword, 10);
    writeJSON('config.json', config);
    res.json({ success: true });
  });

  // API: Admin Users (WhatsApp command users)
  router.get('/api/admin-users', (req, res) => {
    const users = readJSON('adminusers.json') || [];
    res.json(users);
  });

  router.post('/api/admin-users', (req, res) => {
    const { number, name } = req.body;
    if (!number) return res.status(400).json({ error: 'Number is required' });

    const users = readJSON('adminusers.json') || [];
    let cleanNum = number.trim().replace(/\D/g, '');
    if (!cleanNum.endsWith('@c.us')) cleanNum += '@c.us';

    if (users.find(u => u.number === cleanNum)) {
      return res.status(400).json({ error: 'Number already added' });
    }

    const newUser = {
      id: uuidv4(),
      number: cleanNum,
      name: name || cleanNum.replace('@c.us', ''),
      addedAt: new Date().toISOString()
    };
    users.push(newUser);
    writeJSON('adminusers.json', users);
    console.log(`👤 Admin user added: ${cleanNum} (${newUser.name})`);
    res.json({ success: true, user: newUser });
  });

  router.delete('/api/admin-users/:id', (req, res) => {
    let users = readJSON('adminusers.json') || [];
    users = users.filter(u => u.id !== req.params.id);
    writeJSON('adminusers.json', users);
    console.log(`👤 Admin user removed: ${req.params.id}`);
    res.json({ success: true });
  });

  // API: Factory Reset
  router.post('/api/factory-reset', async (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const bcrypt2 = require('bcryptjs');
    const dataDir = path.join(__dirname, '../../data');

    try {
      // Wipe WhatsApp session
      const sessionDir = path.join(__dirname, '../../.wwebjs_auth');
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }

      // Wipe cache
      const cacheDir = path.join(__dirname, '../../.wwebjs_cache');
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }

      // Reset all data files to defaults
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(dataDir, file);
        try { fs.unlinkSync(filePath); } catch (e) {}
      }

      // Destroy WhatsApp client
      try { await client.destroy(); } catch (e) {}
      botState.status = 'offline';
      botState.botWid = null;

      console.log('🔴 FACTORY RESET — All data wiped');
      res.json({ success: true, message: 'All data cleared. Bot will restart.' });

      // Re-create default data files + reinit client after response sent
      setTimeout(async () => {
        try {
          // Recreate config.json with fresh password
          const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
          const hash = await bcrypt2.hash(defaultPassword, 10);
          writeJSON('config.json', {
            adminPasswordHash: hash,
            botPrompt: 'You are a helpful WhatsApp assistant. Reply naturally and concisely. Be friendly.',
            replyToInbox: true,
            replyToGroups: false,
            botName: 'AI Assistant',
            botEnabled: true
          });
          writeJSON('apikeys.json', []);
          writeJSON('blocklist.json', { numbers: [], groups: [] });
          writeJSON('adminusers.json', []);
          console.log('📁 Default data files recreated');
        } catch (e) {
          console.error('❌ Failed to recreate data files:', e.message);
        }

        try { await client.initialize(); } catch (e) {
          console.error('❌ Reinit after reset failed:', e.message);
        }
      }, 3000);
    } catch (e) {
      console.error('❌ Factory reset failed:', e.message);
      res.status(500).json({ error: 'Reset failed: ' + e.message });
    }
  });

  // ─── AI API Management ───

  // List all AI APIs
  router.get('/api/ai-apis', (req, res) => {
    const apis = readJSON('ai_apis.json') || [];
    const masked = apis.map(api => ({
      ...api,
      apiKeyEncrypted: api.apiKeyEncrypted ? '••••••••' + api.apiKeyEncrypted.slice(-6) : ''
    }));
    res.json(masked);
  });

  // Get full API config (for edit modal)
  router.get('/api/ai-apis/:id', (req, res) => {
    const apis = readJSON('ai_apis.json') || [];
    const api = apis.find(a => a.id === req.params.id);
    if (!api) return res.status(404).json({ error: 'API not found' });
    const { decrypt } = require('../storage/encryption');
    res.json({ ...api, apiKey: decrypt(api.apiKeyEncrypted) });
  });

  // Add new AI API
  router.post('/api/ai-apis', (req, res) => {
    const { encrypt } = require('../storage/encryption');
    const { v4: uuidv4 } = require('uuid');
    const {
      name, providerType, endpoint, apiKey, model,
      authType, customHeaders, requestTemplate, responsePath,
      maxTokens, temperature, systemPrompt, priority,
      isActive, httpMethod
    } = req.body;

    if (!name || !providerType) {
      return res.status(400).json({ error: 'Name and provider type are required' });
    }
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const apis = readJSON('ai_apis.json') || [];
    const newAPI = {
      id: uuidv4(),
      name,
      providerType,
      endpoint: endpoint || '',
      apiKeyEncrypted: encrypt(apiKey),
      model: model || '',
      authType: authType || 'bearer',
      customHeaders: customHeaders || {},
      requestTemplate: requestTemplate || '',
      responsePath: responsePath || '',
      maxTokens: maxTokens || 1024,
      temperature: temperature || 0.7,
      systemPrompt: systemPrompt || '',
      priority: priority || (apis.length + 1),
      isActive: isActive !== false,
      isDefault: apis.length === 0,
      httpMethod: httpMethod || 'POST',
      lastTestStatus: null,
      lastTestedAt: null,
      lastTestResponseTime: null,
      lastTestError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    apis.push(newAPI);
    writeJSON('ai_apis.json', apis);
    console.log(`🔑 AI API added: ${name} (${providerType})`);
    res.json({ success: true, id: newAPI.id });
  });

  // Update AI API
  router.put('/api/ai-apis/:id', (req, res) => {
    const { encrypt } = require('../storage/encryption');
    const apis = readJSON('ai_apis.json') || [];
    const api = apis.find(a => a.id === req.params.id);
    if (!api) return res.status(404).json({ error: 'API not found' });

    const {
      name, providerType, endpoint, apiKey, model,
      authType, customHeaders, requestTemplate, responsePath,
      maxTokens, temperature, systemPrompt, priority,
      isActive, httpMethod
    } = req.body;

    if (name) api.name = name;
    if (providerType) api.providerType = providerType;
    if (endpoint !== undefined) api.endpoint = endpoint;
    if (apiKey && apiKey !== '••••••••') api.apiKeyEncrypted = encrypt(apiKey);
    if (model !== undefined) api.model = model;
    if (authType) api.authType = authType;
    if (customHeaders) api.customHeaders = customHeaders;
    if (requestTemplate !== undefined) api.requestTemplate = requestTemplate;
    if (responsePath !== undefined) api.responsePath = responsePath;
    if (maxTokens !== undefined) api.maxTokens = maxTokens;
    if (temperature !== undefined) api.temperature = temperature;
    if (systemPrompt !== undefined) api.systemPrompt = systemPrompt;
    if (priority !== undefined) api.priority = priority;
    if (isActive !== undefined) api.isActive = isActive;
    if (httpMethod) api.httpMethod = httpMethod;
    api.updatedAt = new Date().toISOString();

    writeJSON('ai_apis.json', apis);
    console.log(`✏️ AI API updated: ${api.name}`);
    res.json({ success: true });
  });

  // Delete AI API
  router.delete('/api/ai-apis/:id', (req, res) => {
    let apis = readJSON('ai_apis.json') || [];
    const api = apis.find(a => a.id === req.params.id);
    if (!api) return res.status(404).json({ error: 'API not found' });
    const wasDefault = api.isDefault;
    apis = apis.filter(a => a.id !== req.params.id);
    if (wasDefault && apis.length > 0) {
      apis[0].isDefault = true;
    }
    writeJSON('ai_apis.json', apis);
    console.log(`🗑️ AI API deleted: ${api.name}`);
    res.json({ success: true });
  });

  // Toggle enable/disable
  router.patch('/api/ai-apis/:id/toggle', (req, res) => {
    const apis = readJSON('ai_apis.json') || [];
    const api = apis.find(a => a.id === req.params.id);
    if (!api) return res.status(404).json({ error: 'API not found' });
    api.isActive = !api.isActive;
    api.updatedAt = new Date().toISOString();
    writeJSON('ai_apis.json', apis);
    res.json({ success: true, isActive: api.isActive });
  });

  // Set default
  router.patch('/api/ai-apis/:id/set-default', (req, res) => {
    const apis = readJSON('ai_apis.json') || [];
    apis.forEach(a => a.isDefault = false);
    const api = apis.find(a => a.id === req.params.id);
    if (!api) return res.status(404).json({ error: 'API not found' });
    api.isDefault = true;
    api.updatedAt = new Date().toISOString();
    writeJSON('ai_apis.json', apis);
    res.json({ success: true });
  });

  // Update priority (batch)
  router.put('/api/ai-apis-priority', (req, res) => {
    const { priorities } = req.body;
    if (!Array.isArray(priorities)) return res.status(400).json({ error: 'Invalid data' });
    const apis = readJSON('ai_apis.json') || [];
    for (const p of priorities) {
      const api = apis.find(a => a.id === p.id);
      if (api) api.priority = p.priority;
    }
    writeJSON('ai_apis.json', apis);
    res.json({ success: true });
  });

  // Test AI API
  router.post('/api/ai-apis/:id/test', async (req, res) => {
    try {
      const aiService = require('../ai/service');
      const result = await aiService.testAPI(req.params.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ─── Fallback Messages ───

  router.get('/api/fallback-messages', (req, res) => {
    const messages = readJSON('fallbackmessages.json') || [];
    res.json(messages);
  });

  router.post('/api/fallback-messages', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const messages = readJSON('fallbackmessages.json') || [];
    messages.push(message);
    writeJSON('fallbackmessages.json', messages);
    res.json({ success: true, count: messages.length });
  });

  router.put('/api/fallback-messages', (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'Invalid data' });
    writeJSON('fallbackmessages.json', messages);
    res.json({ success: true, count: messages.length });
  });

  router.delete('/api/fallback-messages/:index', (req, res) => {
    const idx = parseInt(req.params.index);
    const messages = readJSON('fallbackmessages.json') || [];
    if (idx < 0 || idx >= messages.length) return res.status(400).json({ error: 'Invalid index' });
    messages.splice(idx, 1);
    writeJSON('fallbackmessages.json', messages);
    res.json({ success: true, count: messages.length });
  });

  // ─── Soft Restart (keeps session + API keys) ───
  router.post('/api/soft-restart', (req, res) => {
    res.json({ success: true, message: 'Restarting bot...' });
    console.log('🔄 Soft restart triggered from admin panel');
    setTimeout(() => {
      try { client.destroy(); } catch (e) {}
      const cwd = path.join(__dirname, '..', '..');
      const child = spawn('node', ['index.js'], { detached: true, stdio: 'ignore', cwd });
      child.unref();
      process.exit(0);
    }, 800);
  });

  // ─── Live Logs (SSE) ───
  router.get('/api/logs', (req, res) => {
    res.json(logBuffer.slice(-200));
  });

  router.get('/api/logs/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(':\n\n');
    logBuffer.forEach(entry => {
      try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch (e) {}
    });
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // ─── Git Update ───
  router.post('/api/git-update', (req, res) => {
    res.json({ success: true, message: 'Pulling from GitHub...' });
    console.log('📥 Git update triggered from admin panel');
    setTimeout(() => {
      const cwd = path.join(__dirname, '..', '..');
      try {
        console.log('📥 git pull...');
        const pullOutput = execSync('git pull origin main', { cwd, timeout: 30000, encoding: 'utf-8' });
        if (pullOutput.includes('Already up to date') || pullOutput.includes('Already up-to-date')) {
          console.log('✅ No update available');
          return;
        }
        console.log('📦 npm install...');
        execSync('npm install --production', { cwd, timeout: 60000 });
        console.log('✅ Update complete. Restarting...');
        try { client.destroy(); } catch (e) {}
        const child = spawn('node', ['index.js'], { detached: true, stdio: 'ignore', cwd });
        child.unref();
        process.exit(0);
      } catch (e) {
        console.error('❌ Update failed:', e.message);
      }
    }, 500);
  });

  // ─── Auto-Update Toggle ───
  router.get('/api/auto-update', (req, res) => {
    const config = readJSON('config.json') || {};
    res.json({
      enabled: config.autoUpdate === true,
      interval: config.autoUpdateInterval || 30
    });
  });

  router.post('/api/auto-update', (req, res) => {
    const { enabled, interval } = req.body;
    const config = readJSON('config.json') || {};
    config.autoUpdate = enabled === true;
    if (typeof interval === 'number' && interval >= 5) config.autoUpdateInterval = interval;
    writeJSON('config.json', config);
    if (config.autoUpdate) startAutoUpdate();
    else stopAutoUpdate();
    console.log(`🔄 Auto-update ${config.autoUpdate ? 'enabled (' + (config.autoUpdateInterval || 30) + 'min)' : 'disabled'}`);
    res.json({ success: true, enabled: config.autoUpdate, interval: config.autoUpdateInterval || 30 });
  });

  // Start auto-update on boot if enabled
  setTimeout(() => { try { startAutoUpdate(); } catch (e) {} }, 2000);

  return router;
}

module.exports = createRoutes;
