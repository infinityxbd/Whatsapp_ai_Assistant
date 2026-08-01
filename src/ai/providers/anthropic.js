/**
 * Anthropic Claude Provider — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const BaseProvider = require('./base');

class AnthropicProvider extends BaseProvider {
  getEndpoint() {
    return (this.endpoint || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      ...this.customHeaders
    };
  }

  async sendRequest(messages) {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    let body;
    if (this.requestTemplate) {
      try {
        const filled = this.requestTemplate
          .replace(/\{\{API_KEY\}\}/g, this.apiKey)
          .replace(/\{\{MODEL\}\}/g, this.model)
          .replace(/\{\{MESSAGE\}\}/g, messages[messages.length - 1]?.content || '')
          .replace(/\{\{SYSTEM_PROMPT\}\}/g, this.systemPrompt || systemMsg?.content || '')
          .replace(/\{\{MAX_TOKENS\}\}/g, String(this.maxTokens))
          .replace(/\{\{TEMPERATURE\}\}/g, String(this.temperature))
          .replace(/\{\{CONVERSATION\}\}/g, JSON.stringify(nonSystemMsgs));
        body = JSON.parse(filled);
      } catch (e) {
        body = this.buildBody(nonSystemMsgs, systemMsg);
      }
    } else {
      body = this.buildBody(nonSystemMsgs, systemMsg);
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

  buildBody(messages, systemMsg) {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    };
    const sysPrompt = this.systemPrompt || systemMsg?.content;
    if (sysPrompt) body.system = sysPrompt;
    return body;
  }

  parseResponse(data) {
    if (this.responsePath) {
      return this.resolvePath(data, this.responsePath);
    }
    return data.content?.[0]?.text;
  }
}

module.exports = AnthropicProvider;
