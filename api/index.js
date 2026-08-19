// api/index.js — Vercel serverless entry point.
// Vercel auto-detects any file under /api as a serverless function.
// This wraps the SAME express app used by Render/VPS, so all routes
// (auth, otp, messages, mail/send) work identically here.
//
// NOT included: src/receive.js (SMTP receiving) and the direct-to-MX path
// in src/send.js won't function on Vercel - serverless functions can't bind
// a listening port or reliably hold outbound raw-SMTP connections open.
// This deploys auth + webmail UI + database-backed inbox only.

require('dotenv').config();
const serverless = require('serverless-http');
const { app } = require('../src/api');

module.exports = serverless(app);
