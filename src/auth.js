// auth.js
// Everything about "who is logged in" lives here, on the server. Identity is
// now (product, identifier) pairs - the same identifier (email/userId) can
// exist independently in "ecommerce" and "education" without colliding.

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const storage = require('./storage');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET missing or too short. Set a random 32+ char string in .env (e.g. `openssl rand -hex 32`).'
  );
}
const TOKEN_TTL = '2h';
const COOKIE_NAME = 'session';

async function signup(product, identifier, password) {
  product = product.trim().toLowerCase();
  identifier = identifier.trim().toLowerCase();
  if (!(await storage.findProductByName(product))) throw new Error('Unknown product');
  if (!identifier) throw new Error('Identifier required');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters');
  if (await storage.findUser(product, identifier)) throw new Error('Account already exists');

  const hash = await bcrypt.hash(password, 12);
  await storage.createUser(product, identifier, hash);
  return { product, identifier };
}

async function login(product, identifier, password) {
  product = product.trim().toLowerCase();
  identifier = identifier.trim().toLowerCase();
  const user = await storage.findUser(product, identifier);
  if (!user) {
    await bcrypt.compare(password, '$2b$12$invalidsaltinvalidsaltinvalidsal.'); // constant-time-ish decoy
    throw new Error('Invalid identifier or password');
  }
  if (storage.isLocked(user)) {
    throw new Error('Account temporarily locked due to repeated failed attempts. Try again later.');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await storage.recordFailedLogin(product, identifier);
    throw new Error('Invalid identifier or password');
  }
  await storage.clearFailedLogins(product, identifier);
  return { product, identifier };
}

function resetPassword(product, identifier, newPassword) {
  return bcrypt.hash(newPassword, 12).then(hash => storage.updatePassword(product, identifier, hash));
}

function issueToken(product, identifier) {
  return jwt.sign({ product, identifier }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function setSessionCookie(res, product, identifier) {
  const token = issueToken(product, identifier);
  // When frontend and backend are on different origins (separate hosting),
  // the browser needs SameSite=None + Secure to send the cookie cross-site at
  // all - this requires HTTPS even in that setup. When both are on the same
  // origin (or same site via a subdomain), SameSite=Lax/Strict is safer and
  // is the default here. Control via COOKIE_SAME_SITE in .env.
  const sameSite = process.env.COOKIE_SAME_SITE || 'lax';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    maxAge: 2 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Express middleware for the browser-facing webmail UI: verifies the cookie
// server-side and attaches req.user = { product, identifier }.
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { product: payload.product, identifier: payload.identifier };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session invalid or expired' });
  }
}

module.exports = { signup, login, resetPassword, setSessionCookie, clearSessionCookie, requireAuth, COOKIE_NAME };
