/**
 * Base AI Provider Adapter — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
class BaseProvider {
  constructor(config) {
    this.name = config.name;
    this.providerType = config.providerType;
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxTokens = config.maxTokens || 1024;
    this.temperature = config.temperature || 0.7;
    this.systemPrompt = config.systemPrompt || '';
    this.customHeaders = config.customHeaders || {};
    this.requestTemplate = config.requestTemplate || '';
    this.responsePath = config.responsePath || '';
    this.timeout = 30000;
  }

  async sendRequest(messages) {
    throw new Error('sendRequest must be implemented by subclass');
  }

  parseResponse(data) {
    throw new Error('parseResponse must be implemented by subclass');
  }

  async generateReply(userMessage, conversationHistory = []) {
    const startTime = Date.now();
    try {
      const messages = this.buildMessages(userMessage, conversationHistory);
      const data = await this.sendRequest(messages);
      const text = this.parseResponse(data);
      const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);

      if (!text || text.trim().length === 0) {
        return { success: false, error: 'Empty response from API', responseTime };
      }

      return {
        success: true,
        text: text.trim(),
        provider: this.name,
        model: this.model,
        responseTime: parseFloat(responseTime)
      };
    } catch (error) {
      const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);
      return {
        success: false,
        error: error.message || 'Unknown error',
        provider: this.name,
        model: this.model,
        responseTime: parseFloat(responseTime)
      };
    }
  }

  buildMessages(userMessage, conversationHistory) {
    return conversationHistory.map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: h.text
    })).concat({ role: 'user', content: userMessage });
  }

  resolvePath(obj, path) {
    if (!path) return obj;
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }

  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout after ' + (this.timeout / 1000) + 's');
      }
      throw error;
    }
  }
}

module.exports = BaseProvider;
