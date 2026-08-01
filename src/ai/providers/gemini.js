/**
 * Google Gemini Provider — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const BaseProvider = require('./base');

class GeminiProvider extends BaseProvider {
  getEndpoint() {
    const model = this.model || 'gemini-2.0-flash-lite';
    let base = (this.endpoint || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    if (base.includes('generativelanguage.googleapis.com')) {
      return `${base}/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    }
    return `${base}/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
  }

  getContents(messages) {
    const contents = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
    return contents;
  }

  async sendRequest(messages) {
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
          .replace(/\{\{CONVERSATION\}\}/g, JSON.stringify(messages));
        body = JSON.parse(filled);
      } catch (e) {
        body = { contents: this.getContents(messages) };
      }
    } else {
      const contents = this.getContents(messages);
      const systemMsg = messages.find(m => m.role === 'system');
      body = { contents };
      if (systemMsg || this.systemPrompt) {
        body.systemInstruction = {
          parts: [{ text: systemMsg?.content || this.systemPrompt }]
        };
      }
      if (this.temperature) {
        body.generationConfig = {
          temperature: this.temperature,
          maxOutputTokens: this.maxTokens
        };
      }
    }

    const response = await this.fetchWithTimeout(this.getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.customHeaders },
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
    try {
      const parts = data.candidates?.[0]?.content?.parts;
      if (parts && parts.length > 0) {
        return parts.map(p => p.text).join('');
      }
    } catch (e) {}
    return null;
  }
}

module.exports = GeminiProvider;
