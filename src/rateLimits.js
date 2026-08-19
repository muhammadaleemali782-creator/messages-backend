// rateLimits.js
const rateLimit = require('express-rate-limit');

// Login: slow down brute-force guessing. 8 attempts / 10 min per IP.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

// Signup: stop mass account creation. 5 / hour per IP.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created from this network. Try again later.' },
});

// OTP send: this is the one most worth protecting - otherwise someone can spam
// a victim's inbox, or use your server as a mail bomb / spam relay. 3 / 10 min per IP.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests. Please wait before requesting another.' },
});

// General mail send: 20 / hour per IP as a baseline anti-abuse ceiling.
const mailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Send limit reached for this hour.' },
});

// Baseline limiter for everything else (read endpoints).
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests, slow down.' },
});

// OTP verify: the 6-digit code only stays safe from brute force if guessing is slow.
// Combined with the 5-min OTP expiry in otp.js, this caps real-world guess attempts
// to a handful per code, not the ~900,000 possible values.
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Request a new OTP.' },
});

// Reset requests: someone spamming this could flood the admin's queue.
// 5 / hour per IP.
const resetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many reset requests. Please wait before trying again.' },
});

// Admin login: fewer, stricter attempts than regular user login since this
// account can reset anyone's password. 5 / 15 min per IP.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many admin login attempts. Try again later.' },
});

module.exports = {
  loginLimiter, signupLimiter, otpLimiter, mailSendLimiter, generalLimiter, otpVerifyLimiter,
  resetRequestLimiter, adminLoginLimiter,
};
