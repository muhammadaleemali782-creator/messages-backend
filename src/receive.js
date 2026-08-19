// receive.js
// Your own SMTP receiving server. Other mail servers (and your own send.js)
// connect here to deliver mail addressed to @yourdomain.com.
//
// Needs: port 25 open + an MX record pointing your domain at this server's IP.

const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const storage = require('./storage');

const ALLOWED_DOMAIN = process.env.MAIL_DOMAIN || 'yourdomain.com';

const server = new SMTPServer({
  authOptional: true, // internal apps sending OTP mail don't need SMTP auth on this port;
                       // lock this down with authOptional:false + onAuth for production use
  onRcptTo(address, session, cb) {
    if (!address.address.endsWith('@' + ALLOWED_DOMAIN)) {
      return cb(new Error('550 Relay not permitted for this domain'));
    }
    cb();
  },
  onData(stream, session, cb) {
    simpleParser(stream, {}, async (err, parsed) => {
      if (err) return cb(err);
      const to = parsed.to?.value?.[0]?.address || session.envelope.rcptTo[0]?.address;
      const from = parsed.from?.value?.[0]?.address || 'unknown@unknown';
      // Real inbound mail has no product context by itself. Convention: use
      // plus-addressing, e.g. ecommerce+user@yourdomain.com routes replies
      // into the "ecommerce" product namespace. No "+" -> falls into "external".
      const localPart = to.split('@')[0];
      const product = localPart.includes('+') ? localPart.split('+')[0] : 'external';
      try {
        const id = await storage.saveMessage({
          product,
          from,
          to,
          subject: parsed.subject || '(no subject)',
          body: parsed.text || parsed.html || '',
        });
        console.log(`[mail] stored message ${id} for ${to} (product: ${product})`);
        cb();
      } catch (e) {
        cb(e);
      }
    });
  },
});

function start(port = 25) {
  server.listen(port, () => console.log(`SMTP receiving server listening on port ${port}`));
}

module.exports = { start };
