// otp.js
const crypto = require('crypto');
const storage = require('./storage');
const { sendDirect } = require('./send');

const FROM_ADDRESS = process.env.MAIL_FROM || 'no-reply@yourdomain.com';
const OTP_TTL_SECONDS = 5 * 60; // 5 minutes

function genOtp() {
  return String(crypto.randomInt(100000, 999999));
}

async function sendOtp(product, identifier) {
  const otp = genOtp();
  const subject = 'Aapka verification code';
  const text = `Aapka code hai: ${otp}\nYe ${OTP_TTL_SECONDS / 60} minute me expire ho jaayega.`;

  const id = await storage.saveMessage({ product, from: FROM_ADDRESS, to: identifier, subject, body: `OTP:${otp}` });

  // if identifier looks like a real email, also try real delivery; if it's a
  // plain userId (not an email), this step is skipped - the OTP still lands
  // in the in-app "Messages" inbox for the user to read there.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    try { await sendDirect({ from: FROM_ADDRESS, to: identifier, subject, text }); }
    catch (e) { /* in-app copy already saved above; real delivery is best-effort */ }
  }

  return { id, otp }; // don't log/return `otp` in real production responses — shown here for wiring/testing only
}

async function verifyOtp(product, identifier, submittedOtp) {
  const inbox = await storage.listInbox(product, identifier);
  for (const meta of inbox) {
    if (meta.used) continue;
    const full = await storage.getMessage(meta.id);
    if (!full) continue;
    const match = full.body.match(/^OTP:(\d{6})$/);
    if (!match) continue;
    const age = Math.floor(Date.now() / 1000) - full.ts;
    if (match[1] === submittedOtp && age <= OTP_TTL_SECONDS) {
      await storage.markUsed(meta.id);
      return true;
    }
  }
  return false;
}

module.exports = { sendOtp, verifyOtp };
