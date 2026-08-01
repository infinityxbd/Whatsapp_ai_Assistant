/**
 * Encryption — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const secret = process.env.SESSION_SECRET || 'fallback-secret-change-me';
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(16);
    const key = getKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    console.error('❌ Encryption failed:', e.message);
    return text;
  }
}

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  try {
    if (!encryptedText.includes(':')) return encryptedText;
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('❌ Decryption failed:', e.message);
    return encryptedText;
  }
}

function maskKey(apiKey) {
  if (!apiKey || apiKey.length < 8) return '••••••••';
  return apiKey.slice(0, 3) + '••••••••' + apiKey.slice(-4);
}

module.exports = { encrypt, decrypt, maskKey };
