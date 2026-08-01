/**
 * AI Service — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 * Universal provider support with fallback system
 */
const { readJSON, writeJSON } = require('../storage/store');
const { decrypt } = require('../storage/encryption');
const { createProvider } = require('./providers');

const DEFAULT_FALLBACK_MESSAGES = [
  "Assalamu Alaikum, ami ekhon offline achi. Online asle reply dibo In sha Allah.",
  "Hey ki obostha! Ekhon reply dite parchi na. Online asle tumar sathe kotha bolbo.",
  "Sorry ektu busy achi pore reply korbo.",
  "Ami ekhon available na, pore jabo In sha Allah. Tao ki hoise? 😊",
  "Hii! Ekhon kom pawa jacche, pore full reply dibo.",
  "Bhai amar network e ektu problem, pore adda korbo!",
  "Hey! Ami ekhon offline mode e achi. Online hoile reply diya shuru korbo.",
  "Assalamu Alaikum! Ekhon reply dite parbo na. Khoob koshto hoise. pore ashchi In sha Allah.",
  "Sorry bhai, ektu por try koro. Ekhon system down ache.",
  "Ami ekhon theke kichu khon offline. Dorkar hole pore contact koro!",
  "Hey ki khobor! Ekhon ektu busy. Pore porimashallah full response dibo.",
  "Sorry! Technical issue cholche. Ami solve kore fixed soon reply korbo!",
  "Hii! Ekhon ami available na. Bhalo theko, pore kotha boli In sha Allah.",
  "Omg ektu problem! Ekhon reply dite partsina. Tumi ki korchho? Pore bolo.",
  "Assalamu Alaikum bhai, ami ekhon offline. Online hole shotti reply korbo. Thik ache?",
  "Ami ektu bahire achi. Esho pore reply debo! Dorkar hole message roilo.",
  "Sorry re! System e ektu issue. Pore 100% reply dibo In sha Allah.",
  "Hey! Network issue cholche. Ami aschi shotti, ektu wait koro.",
  "Ekhon ektu down achi. Online hoile definitely reply korbo!",
  "Sorry ami ekhon available na. Kintu tomar message dekhechi. Pore reply korbo In sha Allah."
];

function getRandomFallback() {
  const messages = readJSON('fallbackmessages.json');
  const list = (messages && messages.length > 0) ? messages : DEFAULT_FALLBACK_MESSAGES;
  return list[Math.floor(Math.random() * list.length)];
}

function loadAPIs() {
  const apis = readJSON('ai_apis.json') || [];
  return apis
    .filter(api => api.isActive)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

function getAPIConfig(api) {
  return {
    name: api.name,
    providerType: api.providerType,
    endpoint: api.endpoint,
    apiKey: decrypt(api.apiKeyEncrypted),
    model: api.model,
    maxTokens: api.maxTokens || 1024,
    temperature: api.temperature || 0.7,
    systemPrompt: api.systemPrompt || '',
    customHeaders: api.customHeaders || {},
    requestTemplate: api.requestTemplate || '',
    responsePath: api.responsePath || '',
    authType: api.authType || 'bearer',
    httpMethod: api.httpMethod || 'POST'
  };
}

function updateAPIStats(apiId, success, responseTime, error) {
  const apis = readJSON('ai_apis.json') || [];
  const api = apis.find(a => a.id === apiId);
  if (api) {
    api.lastTestStatus = success ? 'ok' : 'error';
    api.lastTestedAt = new Date().toISOString();
    api.lastTestResponseTime = responseTime;
    api.lastTestError = error || null;
    writeJSON('ai_apis.json', apis);
  }
}

class AIService {
  async generateReply(userMessage, conversationHistory = []) {
    const activeAPIs = loadAPIs();

    if (activeAPIs.length === 0) {
      console.log('⚠️ No active AI APIs configured');
      return getRandomFallback();
    }

    const config = readJSON('config.json') || {};
    const botPrompt = config.botPrompt || 'You are a helpful assistant.';

    for (const api of activeAPIs) {
      try {
        const apiConfig = getAPIConfig(api);
        if (!apiConfig.apiKey) {
          console.log(`⚠️ Skipping "${api.name}" — no API key`);
          continue;
        }

        const provider = createProvider(apiConfig);
        if (!apiConfig.systemPrompt && botPrompt) {
          provider.systemPrompt = botPrompt;
        }

        console.log(`🤖 Trying: ${api.name} (${api.providerType}/${api.model})`);
        const result = await provider.generateReply(userMessage, conversationHistory);

        if (result.success) {
          console.log(`✅ ${api.name} responded in ${result.responseTime}s`);
          updateAPIStats(api.id, true, result.responseTime);
          return result.text;
        } else {
          console.log(`❌ ${api.name} failed: ${result.error}`);
          updateAPIStats(api.id, false, result.responseTime, result.error);
        }
      } catch (error) {
        console.log(`❌ ${api.name} error: ${error.message}`);
        updateAPIStats(api.id, false, 0, error.message);
      }
    }

    console.log('⚠️ All APIs failed, using fallback message');
    return getRandomFallback();
  }

  async testAPI(apiId) {
    const apis = readJSON('ai_apis.json') || [];
    const api = apis.find(a => a.id === apiId);
    if (!api) throw new Error('API not found');

    const apiConfig = getAPIConfig(api);
    if (!apiConfig.apiKey) throw new Error('No API key configured');

    const provider = createProvider(apiConfig);
    const config = readJSON('config.json') || {};
    provider.systemPrompt = config.botPrompt || 'You are a helpful assistant. Reply with a short greeting.';

    const result = await provider.generateReply('Hello, this is a test message. Reply with a brief greeting.', []);
    updateAPIStats(api.id, result.success, result.responseTime, result.error);

    return {
      success: result.success,
      provider: api.providerType,
      model: api.model,
      responseTime: result.responseTime,
      error: result.error || null,
      preview: result.success ? result.text.substring(0, 200) : null
    };
  }
}

module.exports = new AIService();
