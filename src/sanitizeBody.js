// sanitizeBody.js
// A minimal, dependency-free replacement for `express-mongo-sanitize`, which
// turned out to be incompatible with this Express version (it tries to
// reassign req.query, which newer Express exposes as getter-only and throws
// on). This only mutates req.body in place - the actual injection surface
// here, since no route builds a MongoDB query from req.query - which is
// always safe to modify.
//
// Strips any object key starting with "$" or containing "." recursively,
// which is how NoSQL operator injection (e.g. {"identifier": {"$ne": null}})
// works. In addition, every route in api.js already runs values through
// src/validate.js's typeof/format checks before they reach a query, so this
// is defense in depth rather than the only safeguard.

function stripBadKeys(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(stripBadKeys);
    return obj;
  }
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete obj[key];
        continue;
      }
      stripBadKeys(obj[key]);
    }
  }
  return obj;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    stripBadKeys(req.body);
  }
  next();
}

module.exports = sanitizeBody;
