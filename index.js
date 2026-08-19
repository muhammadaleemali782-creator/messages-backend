// index.js — run with: node index.js
// RUN_MODE controls which parts start (used by ecosystem.config.js to split
// the clustered API workers from the single SMTP receiver, since only one
// process can bind port 25).
//   RUN_MODE=api-only       -> just the HTTP API (safe to run many of these)
//   RUN_MODE=receiver-only  -> just the SMTP receiver (must be exactly one)
//   unset / anything else   -> both, for simple single-process dev use

require('dotenv').config();
const receive = require('./src/receive');
const api = require('./src/api');

const SMTP_PORT = process.env.SMTP_PORT || 25;
const API_PORT = process.env.PORT || process.env.API_PORT || 3000; // Render/Vercel set PORT automatically
const mode = process.env.RUN_MODE;

if (mode !== 'api-only') receive.start(SMTP_PORT);
if (mode !== 'receiver-only') api.start(API_PORT);
