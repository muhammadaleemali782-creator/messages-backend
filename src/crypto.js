// crypto.js
// Encrypts/decrypts sensitive fields (phone numbers) before they touch the
// database. Unlike password hashing (one-way, bcrypt), this must be
// reversible - the admin needs to actually read the phone number to
// contact someone on WhatsApp - so it's encryption, not hashing.
//
// AES-256-GCM: authenticated encryption, so tampering with stored
// ciphertext is detected (decrypt throws) rather than silently corrupting.

const crypto = require('crypto');

const KEY_HEX = process.env.ENCRYPTION_KEY;
if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error(
    'ENCRYPTION_KEY missing or wrong length. Set a 64-char hex string (32 bytes) in .env (e.g. `openssl rand -hex 32`).'
  );
}
const KEY = Buffer.from(KEY_HEX, 'hex');

function encrypt(plainText) {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store iv + tag + ciphertext together, base64-encoded, as one string
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  if (!payload) return '';
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
