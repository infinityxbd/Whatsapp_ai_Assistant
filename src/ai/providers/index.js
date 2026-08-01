/**
 * Provider Factory — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const OpenAICompatibleProvider = require('./openai-compatible');
const GeminiProvider = require('./gemini');
const AnthropicProvider = require('./anthropic');
const CustomProvider = require('./custom');
const OneMinProvider = require('./1min');

function createProvider(apiConfig) {
  const config = {
    name: apiConfig.name,
    providerType: apiConfig.providerType,
    endpoint: apiConfig.endpoint,
    apiKey: apiConfig.apiKey,
    model: apiConfig.model,
    maxTokens: apiConfig.maxTokens,
    temperature: apiConfig.temperature,
    systemPrompt: apiConfig.systemPrompt,
    customHeaders: apiConfig.customHeaders,
    requestTemplate: apiConfig.requestTemplate,
    responsePath: apiConfig.responsePath,
    authType: apiConfig.authType,
    httpMethod: apiConfig.httpMethod
  };

  switch (apiConfig.providerType) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
    case 'openai-official':
      config.endpoint = config.endpoint || 'https://api.openai.com/v1';
      return new OpenAICompatibleProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case '1min-ai':
      return new OneMinProvider(config);
    case 'custom-rest':
    case 'custom-json':
      return new CustomProvider(config);
    default:
      return new OpenAICompatibleProvider(config);
  }
}

module.exports = { createProvider };
