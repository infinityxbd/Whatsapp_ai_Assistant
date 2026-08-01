/**
 * Custom REST API Provider — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const BaseProvider = require('./base');

class CustomProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.httpMethod = config.httpMethod || 'POST';
    this.authType = config.authType || 'bearer';
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
    } else if (this.authType === 'api-key-upper') {
      headers['API-KEY'] = this.apiKey;
    } else if (this.authType === 'x-api-key') {
      headers['x-api-key'] = this.apiKey;
    } else if (this.authType === 'basic') {
      const b64 = Buffer.from(`user:${this.apiKey}`).toString('base64');
      headers['Authorization'] = `Basic ${b64}`;
    } else if (this.authType === 'custom' && this.customHeaders) {
      Object.assign(headers, this.customHeaders);
    }
    return headers;
  }

  buildUrl() {
    let url = this.endpoint;
    if (this.authType === 'api-key-query') {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}key=${this.apiKey}`;
    }
    return url;
  }

  async sendRequest(messages) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    let body;

    if (this.requestTemplate) {
      try {
        const conversationStr = JSON.stringify(messages);
        body = this.requestTemplate
          .replace(/\{\{API_KEY\}\}/g, this.apiKey)
          .replace(/\{\{MODEL\}\}/g, this.model)
          .replace(/\{\{MESSAGE\}\}/g, lastMsg)
          .replace(/\{\{SYSTEM_PROMPT\}\}/g, this.systemPrompt)
          .replace(/\{\{MAX_TOKENS\}\}/g, String(this.maxTokens))
          .replace(/\{\{TEMPERATURE\}\}/g, String(this.temperature))
          .replace(/\{\{CONVERSATION\}\}/g, conversationStr);
        body = JSON.parse(body);
      } catch (e) {
        body = { message: lastMsg };
      }
    } else {
      body = { message: lastMsg };
    }

    const response = await this.fetchWithTimeout(this.buildUrl(), {
      method: this.httpMethod,
      headers: this.getHeaders(),
      body: this.httpMethod === 'POST' ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errBody.substring(0, 200)}`);
    }

    return response.json();
  }

  parseResponse(data) {
    if (this.responsePath) {
      const raw = this.resolvePath(data, this.responsePath);
      if (Array.isArray(raw)) return raw.join('\n');
      if (raw != null) return String(raw);
    }
    return data.choices?.[0]?.message?.content || data.text || data.content || data.response;
  }
}

module.exports = CustomProvider;
