// send.js
// Sends mail directly to the recipient domain's MX server using SMTP -
// no third-party relay (no Gmail, no SendGrid). This is exactly how real
// mail servers talk to each other.
//
// IMPORTANT (read this): most cloud hosts (AWS, GCP, DigitalOcean, etc.)
// block outbound port 25 by default to fight spam. You need either:
//   (a) a VPS/provider that allows outbound 25 (many do on request), or
//   (b) a residential/dedicated line with clean reverse-DNS.
// Without this, your mail will simply fail to connect to other providers'
// servers (Gmail, Outlook, etc. will refuse or silently drop it).
// This code is correct and works once port 25 is open on your box.

const dns = require('dns').promises;
const nodemailer = require('nodemailer');

async function resolveMx(domain) {
  const records = await dns.resolveMx(domain);
  records.sort((a, b) => a.priority - b.priority); // lowest priority number = tried first
  return records;
}

async function sendDirect({ from, to, subject, text, html }) {
  const domain = to.split('@')[1];
  if (!domain) throw new Error('Invalid recipient address');

  const mxRecords = await resolveMx(domain);
  if (!mxRecords.length) throw new Error(`No MX record found for ${domain}`);

  let lastErr;
  for (const mx of mxRecords) {
    try {
      const transporter = nodemailer.createTransport({
        host: mx.exchange,
        port: 25,
        secure: false,          // start plaintext, upgrade via STARTTLS if offered
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
      });

      const info = await transporter.sendMail({ from, to, subject, text, html });
      return { ok: true, mxUsed: mx.exchange, messageId: info.messageId };
    } catch (err) {
      lastErr = err; // try next MX record
    }
  }
  throw new Error(`All MX attempts failed for ${domain}: ${lastErr?.message}`);
}

module.exports = { sendDirect, resolveMx };
