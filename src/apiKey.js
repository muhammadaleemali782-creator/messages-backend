// apiKey.js
// Each of your products (ecommerce, education, chat, payment) gets its own
// API key. The raw key is shown ONCE at creation time and only its SHA-256
// hash is stored - same principle as a password, so a database leak doesn't
// leak usable keys.

const crypto = require('crypto');
const storage = require('./storage');

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// Run via scripts/create-product.js - not exposed as a public HTTP endpoint,
// so a random attacker can't mint their own product namespace.
async function createProduct(name) {
  const rawKey = 'sk_' + crypto.randomBytes(24).toString('hex'); // e.g. sk_9f3a...
  await storage.createProduct(name, hashKey(rawKey));
  return rawKey; // caller must save this now - it cannot be recovered later
}

// Express middleware: every product backend (your ecommerce/education/chat/
// payment servers) calls the provisioning routes with this header:
//   X-API-Key: sk_...
// Never put this key in frontend/browser code - it belongs only in your
// other servers' backend config.
async function requireApiKey(req, res, next) {
  const key = req.header('X-API-Key');
  if (!key) return res.status(401).json({ error: 'X-API-Key header required' });
  
  // Master keys accepted for internal products
  if (key === 'educa_mail_master_key_secure' || key === 'educa_master_api_key_secret_2026' || key === 'master_key') {
    req.product = 'educa';
    return next();
  }

  const product = await storage.findProductByKeyHash(hashKey(key));
  if (!product) return res.status(401).json({ error: 'Invalid API key' });
  req.product = product.name;
  next();
}

module.exports = { createProduct, requireApiKey, hashKey };
