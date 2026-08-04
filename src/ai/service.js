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
  /**
   * Shared provider loop: tries every active API in priority order and
   * returns the first successful text response. Logs per-API attempts and
   * updates health stats exactly like the old generateReply body.
   */
  async _ask(userMessage, conversationHistory = [], options = {}) {
    const activeAPIs = loadAPIs();
    if (activeAPIs.length === 0) {
      console.log('⚠️ No active AI APIs configured');
      return { success: false, text: '', error: 'no_active_apis' };
    }

    const config = readJSON('config.json') || {};
    const botPrompt = config.botPrompt || 'You are a helpful assistant.';
    const systemPrompt = (options && options.systemPrompt) || '';
    const memoryContext = (options && options.memoryContext) || '';
    // Structured calls (e.g. the JSON decision engine) MUST keep their own
    // instructions even when the API has a custom persona prompt configured,
    // otherwise the model may return prose instead of the expected JSON.
    const forceSystemPrompt = !!(options && options.forceSystemPrompt);

    for (const api of activeAPIs) {
      try {
        const apiConfig = getAPIConfig(api);
        if (!apiConfig.apiKey) {
          console.log(`⚠️ Skipping "${api.name}" — no API key`);
          continue;
        }

        const provider = createProvider(apiConfig);
        // Normal precedence: per-API prompt > per-message override (e.g. the
        // group personality prompt) > global bot prompt. For structured calls
        // (forceSystemPrompt) the per-message instructions always win. The
        // user-memory context is appended when present so the model can
        // personalize replies without sending full conversation history.
        let finalPrompt = forceSystemPrompt
          ? (systemPrompt || apiConfig.systemPrompt || botPrompt)
          : (apiConfig.systemPrompt || systemPrompt || botPrompt);
        if (memoryContext) {
          finalPrompt += '\n\n' + memoryContext;
        }
        provider.systemPrompt = finalPrompt;

        console.log(`🤖 Trying: ${api.name} (${api.providerType}/${api.model})`);
        const result = await provider.generateReply(userMessage, conversationHistory);

        if (result.success) {
          console.log(`✅ ${api.name} responded in ${result.responseTime}s`);
          updateAPIStats(api.id, true, result.responseTime);
          return { success: true, text: result.text };
        } else {
          console.log(`❌ ${api.name} failed: ${result.error}`);
          updateAPIStats(api.id, false, result.responseTime, result.error);
        }
      } catch (error) {
        console.log(`❌ ${api.name} error: ${error.message}`);
        updateAPIStats(api.id, false, 0, error.message);
      }
    }

    return { success: false, text: '', error: 'all_apis_failed' };
  }

  /**
   * Generate a reply.
   * @param {string} userMessage
   * @param {Array}  conversationHistory  recent chat messages (short-term)
   * @param {Object} [options]            { memoryContext, systemPrompt }
   */
  async generateReply(userMessage, conversationHistory = [], options = {}) {
    const result = await this._ask(userMessage, conversationHistory, options);
    if (result.success) return result.text;
    console.log('⚠️ All APIs failed, using fallback message');
    return getRandomFallback();
  }

  /**
   * Hybrid AI decision flow — "unclear message" tier.
   * Sends the message + full context (sender, group, bot WID, bot names,
   * reply metadata, quoted message, last N messages) to the main AI and asks
   * it to decide, as strict JSON:
   *   { shouldReply, target, intent, confidence, reply }
   * Returns a sanitized decision object. On failure it defaults to NOT
   * replying (conservative — avoids token waste and spam).
   * @param {Object} context  { body, senderName, senderId, groupId, botWid,
   *                           botNames, isReplyToBot, quotedText, quotedAuthor,
   *                           history }
   */
  async classifyGroupMessage(context = {}) {
    const body = String(context.body || '').trim();
    const botNames = (context.botNames || []).map(n => String(n)).filter(Boolean);
    const namesTxt = botNames.length ? botNames.join(', ') : '(none) — the bot has no configured name';
    const history = Array.isArray(context.history) ? context.history : [];

    const lines = history.map((h, i) => {
      const who = h.role === 'model' ? 'bot' : 'user';
      return `${i + 1}. ${who}: ${String(h.text || '').replace(/\n/g, ' ')}`;
    }).join('\n') || '(no recent messages)';

    const decisionPrompt = `You are the decision engine for a WhatsApp GROUP bot named "${context.botName || 'AI Assistant'}" (it also answers to: ${namesTxt}).

A new group message arrived. Decide whether the bot should reply and how.

MESSAGE:
"${body}"

CONTEXT:
- Sender: ${context.senderName || '(unknown)'} (${context.senderId || '?'})
- Group: ${context.groupId || '?'}
- Bot WhatsApp ID: ${context.botWid || '?'}
- Is a reply to the bot's own message: ${context.isReplyToBot ? 'yes' : 'no'}
- Quoted message: "${context.quotedText || '(none)'}"${context.quotedAuthor ? ` (sent by ${context.quotedAuthor})` : ''}
- Recent messages (oldest → newest):\n${lines}

DECISION RULES (follow strictly):
1. Never decide from a keyword alone.
2. A person's name in a message does NOT automatically mean the message is for that person.
3. A person's name in a message does NOT automatically mean the message is for the bot.
4. If clearly directed at the bot (its name/alias, @mention, or a reply to the bot's message) → shouldReply=true, target="bot".
5. If it is an open question to the whole group ("Keo aso?", "Sobai kemon aso?", "Keu jane?") → shouldReply=true, target="group", reply like a natural short group member.
6. If clearly directed at ANOTHER specific group member ("Rahim koi?") or a private human-to-human exchange → shouldReply=false, target="specific_user".
7. If uncertain, prefer shouldReply=false UNLESS the context strongly suggests the conversation is continuing with the bot.
8. The bot replies like a real person: SHORT (1-2 sentences), casual, natural, no bullet points, friendly mix of Bangla/Banglish and English, occasional emoji. Never mention being an AI or bot.

Reply with ONLY a JSON object (no markdown, no extra text):
{"shouldReply": true or false, "target": "bot" or "group" or "specific_user" or "unknown", "intent": "question" or "greeting" or "correction" or "reaction" or "casual" or "human_chat", "confidence": 0 to 1, "reply": "short natural reply if shouldReply=true, else empty string"}`;

    const result = await this._ask(body, [], { systemPrompt: decisionPrompt, forceSystemPrompt: true });
    const parsed = parseDecisionJson(result.success ? result.text : '');

    if (!parsed) {
      console.log(`🧠 Decision engine failed (${result.error || 'unparseable'}) → default: no reply`);
      return { shouldReply: false, target: 'unknown', intent: 'casual', confidence: 0, reply: '' };
    }

    const validTargets = ['bot', 'group', 'specific_user', 'unknown'];
    const validIntents = ['question', 'greeting', 'correction', 'reaction', 'casual', 'human_chat'];
    const conf = parseFloat(parsed.confidence);
    const reply = String(parsed.reply || '').trim();
    return {
      shouldReply: parsed.shouldReply === true,
      target: validTargets.includes(parsed.target) ? parsed.target : 'unknown',
      intent: validIntents.includes(parsed.intent) ? parsed.intent : 'casual',
      confidence: isNaN(conf) ? 0 : Math.min(Math.max(conf, 0), 1),
      reply
    };
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

// Robustly extract a JSON object from a model response: tolerates markdown
// fences, surrounding prose and trailing punctuation.
function parseDecisionJson(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : t;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (e) {}
  }
  try {
    return JSON.parse(candidate);
  } catch (e) {
    return null;
  }
}

module.exports = new AIService();
