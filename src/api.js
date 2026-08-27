// api.js
//
// Security principle followed throughout this file: the client (browser or
// another product's backend) never gets to decide anything security-relevant.
// It only supplies raw input, which is validated/sanitized here (src/validate.js),
// and identity, which is ALWAYS re-derived server-side from either the signed
// session cookie (auth.requireAuth) or the API key (apiKey.requireApiKey) -
// never trusted from a request body/query field.
//
// Two kinds of callers hit this API:
//  1. Your OTHER products' backends -> /provision/* routes, X-API-Key header.
//  2. End users' browsers -> /auth/* + cookie session, no API key involved.

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const sanitizeBody = require('./sanitizeBody');

const auth = require('./auth');
const adminAuth = require('./adminAuth');
const storage = require('./storage');
const { requireApiKey } = require('./apiKey');
const { sendOtp, verifyOtp } = require('./otp');
const { sendDirect } = require('./send');
const v = require('./validate');
const {
  loginLimiter, signupLimiter, otpLimiter, otpVerifyLimiter, mailSendLimiter, generalLimiter,
  resetRequestLimiter, adminLoginLimiter,
} = require('./rateLimits');

const app = express();

// Behind Render/nginx/any reverse proxy, Express otherwise sees the proxy's IP
// for every request - which would make IP-based rate limiting (src/rateLimits.js)
// and the `secure` cookie flag behave incorrectly (one shared limit for all
// users, or cookies not marked secure). This makes Express trust the
// X-Forwarded-* headers from exactly one hop (the proxy in front of it).
app.set('trust proxy', 1);

// Explicit CSP: only this origin's own external scripts/styles + the one font
// CDN the UI uses. No 'unsafe-inline' for scripts - this is only safe because
// public/app.js is an external same-origin file and every event handler in
// public/index.html is bound via addEventListener, never onclick="" attributes.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use(sanitizeBody); // strips $-prefixed / dotted keys from req.body - NoSQL operator injection defense
app.use(cookieParser());
app.use(generalLimiter);
// No static file serving here - the frontend is now a fully separate project
// (../frontend) that talks to this API purely over HTTP. Deploy it anywhere
// (Vercel/Netlify/S3/nginx) - it doesn't need to run on the same server or
// even the same host as this backend.

function badRequest(res, error) { return res.status(400).json({ error }); }

// ---------------- PROVISIONING (called by your OTHER products' backends) ----------------

app.post('/provision/signup', requireApiKey, signupLimiter, async (req, res) => {
  const { identifier, password } = req.body;
  if (!v.isValidIdentifier(identifier)) return badRequest(res, 'Invalid identifier');
  if (!v.isValidPassword(password)) return badRequest(res, 'Password must be 8-200 characters');
  try {
    const created = await auth.signup(req.product, identifier, password);
    res.json({ ok: true, ...created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/provision/update-password', requireApiKey, async (req, res) => {
  const { identifier, newPassword } = req.body;
  if (!v.isValidIdentifier(identifier)) return badRequest(res, 'Invalid identifier');
  if (!v.isValidPassword(newPassword)) return badRequest(res, 'Password must be 8-200 characters');
  try {
    await auth.resetPassword(identifier, newPassword);
    res.json({ ok: true, message: 'Password updated successfully in mail server' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/provision/otp-send', requireApiKey, otpLimiter, async (req, res) => {
  const { identifier } = req.body;
  if (!v.isValidIdentifier(identifier)) return badRequest(res, 'Invalid identifier');
  if (!(await storage.findUser(req.product, identifier))) return res.json({ ok: true }); // don't reveal existence
  try {
    await sendOtp(req.product, identifier);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not send OTP right now.' });
  }
});

app.post('/provision/otp-verify', requireApiKey, otpVerifyLimiter, async (req, res) => {
  const { identifier, otp } = req.body;
  if (!v.isValidIdentifier(identifier)) return badRequest(res, 'Invalid identifier');
  if (!v.isValidOtp(otp)) return badRequest(res, 'OTP must be 6 digits');
  const valid = await verifyOtp(req.product, identifier, otp);
  res.json({ ok: valid });
});

app.post('/provision/message', requireApiKey, mailSendLimiter, async (req, res) => {
  const { to, subject, body } = req.body;
  if (!v.isValidIdentifier(to)) return badRequest(res, 'Invalid recipient');
  if (!v.isValidSubject(subject)) return badRequest(res, 'Subject required, max 300 chars');
  if (body !== undefined && !v.isValidBody(body)) return badRequest(res, 'Body too long');
  const from = `no-reply@${req.product}`;
  await storage.saveMessage({
    product: req.product, from, to,
    subject: v.sanitizePlainText(subject),
    body: v.sanitizePlainText(body || ''),
  });
  res.json({ ok: true });
});

// ---------------- BROWSER AUTH (end users, via cookie session) ----------------
// No product selector in this UI - fixed to a single product (src/config.js).
// Signup takes a display name + password + phone; the email/username is
// generated server-side (Gmail-style, with duplicate suggestion built in).

app.post('/auth/signup', signupLimiter, async (req, res) => {
  const { name, password, phone } = req.body;
  if (!v.isValidName(name)) return badRequest(res, 'Name must be 2-60 characters');
  if (!v.isValidPassword(password)) return badRequest(res, 'Password must be 8-200 characters');
  if (phone !== undefined && phone !== '' && !v.isValidPhone(phone)) {
    return badRequest(res, 'Phone must be 7-16 digits');
  }
  try {
    const created = await auth.signup(name, password, phone ? v.normalizePhone(phone) : '');
    auth.setSessionCookie(res, created.product, created.identifier);
    const token = auth.issueToken(created.product, created.identifier);
    res.json({ ok: true, token, ...created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/auth/login', loginLimiter, async (req, res) => {
  const { identifier, password } = req.body;
  if (!v.isValidIdentifier(identifier) || typeof password !== 'string') {
    return res.status(401).json({ error: 'Invalid email or password' }); // generic - don't leak which field failed
  }
  try {
    const loggedIn = await auth.login(identifier, password);
    auth.setSessionCookie(res, loggedIn.product, loggedIn.identifier);
    const token = auth.issueToken(loggedIn.product, loggedIn.identifier);
    res.json({ ok: true, token, ...loggedIn });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/auth/me', auth.requireAuth, (req, res) => {
  res.json(req.user);
});

// ---------------- PASSWORD RESET (OTP, public but rate-limited) ----------------

app.post('/otp/send', otpLimiter, async (req, res) => {
  const { product, identifier } = req.body;
  if (!v.isValidProduct(product) || !v.isValidIdentifier(identifier)) return res.json({ ok: true }); // don't leak validity
  if (!(await storage.findUser(product, identifier))) return res.json({ ok: true });
  try {
    await sendOtp(product, identifier);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not send OTP right now.' });
  }
});

app.post('/otp/reset-password', otpVerifyLimiter, async (req, res) => {
  const { product, identifier, otp, newPassword } = req.body;
  if (!v.isValidProduct(product)) return badRequest(res, 'Invalid product');
  if (!v.isValidIdentifier(identifier)) return badRequest(res, 'Invalid identifier');
  if (!v.isValidOtp(otp)) return badRequest(res, 'OTP must be 6 digits');
  if (!v.isValidPassword(newPassword)) return badRequest(res, 'Password must be 8-200 characters');
  const valid = await verifyOtp(product, identifier, otp);
  if (!valid) return badRequest(res, 'Invalid or expired OTP');
  await auth.resetPassword(identifier, newPassword);
  res.json({ ok: true });
});

// ---------------- MAILBOX (browser, requires login) ----------------

app.get('/messages', auth.requireAuth, async (req, res) => {
  res.json(await storage.listInbox(req.user.product, req.user.identifier));
});

app.get('/message/:id', auth.requireAuth, async (req, res) => {
  const msg = await storage.getMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'not found' });
  if (msg.product !== req.user.product || (msg.to !== req.user.identifier && msg.from !== req.user.identifier)) {
    return res.status(403).json({ error: 'Not your message' }); // ownership enforced server-side, always
  }
  await storage.markRead(req.params.id);
  res.json(msg);
});

app.post('/mail/send', auth.requireAuth, mailSendLimiter, async (req, res) => {
  const { to, subject, body } = req.body;
  const from = req.user.identifier; // sender identity from session, never from the body - client cannot spoof "from"
  if (!v.isValidIdentifier(to)) return badRequest(res, 'Invalid recipient');
  if (!v.isValidSubject(subject)) return badRequest(res, 'Subject required, max 300 chars');
  if (body !== undefined && !v.isValidBody(body)) return badRequest(res, 'Body too long');
  try {
    await storage.saveMessage({
      product: req.user.product, from, to,
      subject: v.sanitizePlainText(subject),
      body: v.sanitizePlainText(body || ''),
    });
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      try { await sendDirect({ from, to, subject, text: body || '' }); } catch (e) { /* best-effort real delivery */ }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- MANUAL PASSWORD RESET REQUEST (admin-handled, e.g. via WhatsApp) ----------------
// This doesn't touch the OTP/email flow above at all - it's a separate, simpler
// path: user submits their email + the phone number they signed up with. Only
// if that phone matches what's on file (encrypted, see src/crypto.js) does a
// pending request actually get created - so this can't be used to spam an
// admin's queue for accounts that aren't yours, or to probe which identifiers
// exist. An admin then reviews it in /admin.html and manually sets a new
// password, which they relay to the user themselves (WhatsApp, call, etc) -
// that hand-off happens outside this system entirely.

app.post('/reset-request', resetRequestLimiter, async (req, res) => {
  const { identifier, phone } = req.body;
  if (!v.isValidIdentifier(identifier)) return badRequest(res, 'Invalid identifier');
  if (!v.isValidPhone(phone)) return badRequest(res, 'Phone must be 7-16 digits');
  // Always the same response either way - don't reveal whether the identifier
  // exists or whether the phone matched.
  await auth.checkAndCreateResetRequest(identifier, phone);
  res.json({ ok: true });
});

// ---------------- ADMIN (separate login, separate cookie, manual reset handling) ----------------

// One-time admin creation over HTTP - needed because Render's free tier has
// no Shell access. Locked behind ADMIN_SETUP_KEY, a secret only you set in
// Render's Environment tab (never in code, never in git). Anyone without
// that exact key gets a 401 - this is not reachable by guessing.
app.post('/admin/bootstrap', adminLoginLimiter, async (req, res) => {
  const setupKey = process.env.ADMIN_SETUP_KEY;
  if (!setupKey) return res.status(503).json({ error: 'ADMIN_SETUP_KEY not configured on the server' });
  if (req.header('X-Setup-Key') !== setupKey) return res.status(401).json({ error: 'Invalid setup key' });

  const { username, password } = req.body;
  if (!v.isValidUsername(username)) return badRequest(res, 'Username must be 3-40 letters/numbers/underscore');
  if (!v.isValidPassword(password)) return badRequest(res, 'Password must be 8-200 characters');
  if (await storage.findAdmin(username)) return badRequest(res, 'Admin already exists');

  await adminAuth.createAdmin(username, password);
  res.json({ ok: true, username });
});

app.post('/admin/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  try {
    const loggedIn = await adminAuth.login(username, password);
    adminAuth.setSessionCookie(res, loggedIn);
    res.json({ ok: true, username: loggedIn });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/admin/logout', (req, res) => {
  adminAuth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/admin/me', adminAuth.requireAdminAuth, (req, res) => {
  res.json(req.admin);
});

app.get('/admin/requests', adminAuth.requireAdminAuth, async (req, res) => {
  res.json(await storage.listPendingRequests());
});

app.post('/admin/requests/:id/resolve', adminAuth.requireAdminAuth, async (req, res) => {
  const request = await storage.getResetRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return badRequest(res, 'Already resolved');

  let { newPassword } = req.body;
  if (newPassword !== undefined && !v.isValidPassword(newPassword)) {
    return badRequest(res, 'Password must be 8-200 characters');
  }
  if (!newPassword) {
    // generate a random one if the admin didn't type one in
    newPassword = require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g, '');
  }

  await auth.resetPassword(request.identifier, newPassword);
  await storage.resolveResetRequest(req.params.id, req.admin.username);

  // The plaintext password is returned exactly once, here, to the admin who
  // is handling this specific request - never stored anywhere, never logged.
  // The admin is expected to relay it manually (WhatsApp, call, etc).
  res.json({ ok: true, newPassword, identifier: request.identifier, contact: request.contact });
});

function start(port = 3000) {
  app.listen(port, () => console.log(`API listening on port ${port}`));
}

module.exports = { start, app };
