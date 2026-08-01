/**
 * 1min.ai Dedicated Provider — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 *
 * Uses the official Chat with AI API:
 * POST https://api.1min.ai/api/chat-with-ai
 * Auth: API-KEY header
 */
const BaseProvider = require('./base');

class OneMinProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.endpoint = config.endpoint || 'https://api.1min.ai/api/chat-with-ai';
  }

  async sendRequest(messages) {
    const lastMsg = messages[messages.length - 1]?.content || '';

    // Build prompt with system prompt + conversation context
    let fullPrompt = '';
    if (this.systemPrompt) {
      fullPrompt += `[System Instruction: ${this.systemPrompt}]\n\n`;
    }
    // Add conversation history as context
    if (messages.length > 1) {
      const history = messages.slice(0, -1);
      for (const m of history) {
        const role = m.role === 'assistant' ? 'Assistant' : 'User';
        fullPrompt += `${role}: ${m.content}\n`;
      }
      fullPrompt += `\nUser: ${lastMsg}`;
    } else {
      fullPrompt += lastMsg;
    }

    const body = {
      type: 'UNIFY_CHAT_WITH_AI',
      model: this.model || 'gpt-4o-mini',
      promptObject: {
        prompt: fullPrompt,
        settings: {
          historySettings: { isMixed: false, historyMessageLimit: 10 }
        }
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'API-KEY': this.apiKey
    };

    const response = await this.fetchWithTimeout(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`1min.ai HTTP ${response.status}: ${errBody.substring(0, 300)}`);
    }

    return response.json();
  }

  parseResponse(data) {
    const result = data?.aiRecord?.aiRecordDetail?.resultObject;
    if (Array.isArray(result)) return result.join('\n');
    if (typeof result === 'string') return result;
    return data?.aiRecord?.aiRecordDetail?.promptObject?.response || JSON.stringify(data);
  }
}

module.exports = OneMinProvider;
