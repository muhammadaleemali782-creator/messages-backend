// validate.js
// Single source of truth for "is this input acceptable" - every route calls
// into here rather than trusting anything the client sends. Keeping it in
// one file means there's no route that accidentally skips a check.

const IDENTIFIER_RE = /^[a-zA-Z0-9._%+-]{1,190}(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/; // email OR plain userId
const PRODUCT_RE = /^[a-z0-9_-]{2,40}$/;

function isValidIdentifier(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 190 && IDENTIFIER_RE.test(v.trim());
}
function isValidProduct(v) {
  return typeof v === 'string' && PRODUCT_RE.test(v.trim().toLowerCase());
}
function isValidPassword(v) {
  return typeof v === 'string' && v.length >= 8 && v.length <= 200; // upper bound stops bcrypt DoS via huge inputs
}
function isValidSubject(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 300;
}
function isValidBody(v) {
  return typeof v === 'string' && v.length <= 20000; // ~20KB cap per message body, well under the 100kb request cap
}
function isValidOtp(v) {
  return typeof v === 'string' && /^\d{6}$/.test(v);
}

// Strips characters/sequences that have no business being in plain-text mail
// content and are common injection/control-character abuse vectors. This is
// intentionally conservative - it doesn't try to allow "safe HTML", it just
// keeps stored content as plain text. Rendering layers (public/index.html)
// additionally escape on display as defense in depth, but storage itself
// should never hold executable markup.
function sanitizePlainText(v) {
  return String(v)
    .replace(/<[^>]*>/g, '')                         // strip any HTML/script tags outright
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // strip control chars (keep \n \t)
    .trim();
}

module.exports = {
  isValidIdentifier, isValidProduct, isValidPassword,
  isValidSubject, isValidBody, isValidOtp, sanitizePlainText,
};
