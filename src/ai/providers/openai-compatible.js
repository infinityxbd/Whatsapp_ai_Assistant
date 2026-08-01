/**
 * OpenAI Compatible Provider — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const BaseProvider = require('./base');

class OpenAICompatibleProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.authType = config.authType || 'bearer';
  }

  getEndpoint() {
    let base = this.endpoint.replace(/\/+$/, '');
    if (!base.endsWith('/chat/completions')) {
      base += '/chat/completions';
    }
    return base;
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      ...this.customHeaders
    };
    if (this.authType === 'bearer') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else if (this.authType === 'api-key-header') {
      headers['api-key'] = this.apiKey;
    } else if (this.authType === 'x-api-key') {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  async sendRequest(messages) {
    const systemMsg = this.systemPrompt ? [{ role: 'system', content: this.systemPrompt }] : [];
    const allMessages = [...systemMsg, ...messages];

    let body;
    if (this.requestTemplate) {
      try {
        const filled = this.requestTemplate
          .replace(/\{\{API_KEY\}\}/g, this.apiKey)
          .replace(/\{\{MODEL\}\}/g, this.model)
          .replace(/\{\{MESSAGE\}\}/g, messages[messages.length - 1]?.content || '')
          .replace(/\{\{SYSTEM_PROMPT\}\}/g, this.systemPrompt)
          .replace(/\{\{MAX_TOKENS\}\}/g, String(this.maxTokens))
          .replace(/\{\{TEMPERATURE\}\}/g, String(this.temperature))
          .replace(/\{\{CONVERSATION\}\}/g, JSON.stringify(allMessages));
        body = JSON.parse(filled);
      } catch (e) {
        body = {
          model: this.model,
          messages: allMessages,
          temperature: this.temperature,
          max_tokens: this.maxTokens
        };
      }
    } else {
      body = {
        model: this.model,
        messages: allMessages,
        temperature: this.temperature,
        max_tokens: this.maxTokens
      };
    }

    const response = await this.fetchWithTimeout(this.getEndpoint(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errBody.substring(0, 200)}`);
    }

    return response.json();
  }

  parseResponse(data) {
    if (this.responsePath) {
      return this.resolvePath(data, this.responsePath);
    }
    return data.choices?.[0]?.message?.content;
  }
}

module.exports = OpenAICompatibleProvider;
