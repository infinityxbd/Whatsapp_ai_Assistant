/**
 * Gemini AI — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { readJSON } = require('../storage/store');

const FALLBACK_MESSAGES = [
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
  const index = Math.floor(Math.random() * FALLBACK_MESSAGES.length);
  return FALLBACK_MESSAGES[index];
}

class GeminiManager {
  async generateReply(userMessage, conversationHistory = []) {
    const apiKeys = readJSON('apikeys.json') || [];
    const enabledKeys = apiKeys.filter(k => k.enabled);

    if (enabledKeys.length === 0) {
      console.log('⚠️ No enabled API keys found');
      return getRandomFallback();
    }

    const config = readJSON('config.json') || {};
    const botPrompt = config.botPrompt || 'You are a helpful assistant.';

    for (const key of enabledKeys) {
      try {
        const genAI = new GoogleGenerativeAI(key.apiKey);

        const modelOptions = {
          model: key.model || 'gemini-2.0-flash-lite',
          systemInstruction: botPrompt,
        };

        if (key.endpoint && key.endpoint !== 'https://generativelanguage.googleapis.com') {
          modelOptions.baseUrl = key.endpoint;
        }

        const model = genAI.getGenerativeModel(modelOptions);

        let result;
        if (conversationHistory.length > 1) {
          const history = conversationHistory.slice(0, -1).map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.text }]
          }));

          const chat = model.startChat({ history });
          result = await chat.sendMessage(userMessage);
        } else {
          result = await model.generateContent(userMessage);
        }

        const response = result.response;
        const text = response.text();

        if (text && text.trim().length > 0) {
          return text.trim();
        }
      } catch (error) {
        console.log(`⚠️ API key "${key.name}" failed: ${error.message}`);
        continue;
      }
    }

    console.log('⚠️ All API keys failed, using fallback message');
    return getRandomFallback();
  }
}

module.exports = new GeminiManager();
