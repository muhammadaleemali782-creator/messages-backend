// adminAuth.js
// Completely separate from src/auth.js (regular user login). Different cookie
// name, different JWT payload shape - an admin session can never be confused
// with or escalated from a regular user session, and vice versa.

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const storage = require('./storage');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET missing or too short.');
}
const COOKIE_NAME = 'admin_session';
const TOKEN_TTL = '4h';

async function login(username, password) {
  const admin = await storage.findAdmin(username);
  if (!admin) {
    await bcrypt.compare(password, '$2b$12$invalidsaltinvalidsaltinvalidsal.');
    throw new Error('Invalid username or password');
  }
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) throw new Error('Invalid username or password');
  return admin.username;
}

function setSessionCookie(res, username) {
  const token = jwt.sign({ admin: true, username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  const sameSite = process.env.COOKIE_SAME_SITE || 'lax';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    maxAge: 4 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function requireAdminAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated as admin' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.admin) throw new Error('not an admin token');
    req.admin = { username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Admin session invalid or expired' });
  }
}

async function createAdmin(username, password) {
  const hash = await bcrypt.hash(password, 12);
  await storage.createAdmin(username, hash);
}

module.exports = { login, createAdmin, setSessionCookie, clearSessionCookie, requireAdminAuth, COOKIE_NAME };
