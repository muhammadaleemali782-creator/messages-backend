// storage.js — MongoDB version (mongoose)
// Compactness carried over from the SQLite design:
//   - subject/body are zlib-deflated before storage (Buffer field)
//   - flags packed into a single Number bitmask instead of separate booleans
//   - MongoDB's ObjectId is already a compact 12-byte binary id under the hood
//     (the 24-char hex string you see is just its display form) - no extra
//     encoding needed there, unlike the auto-increment+base62 trick SQLite needed.

const mongoose = require('mongoose');
const zlib = require('zlib');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('MONGODB_URI not set. Put your MongoDB Atlas connection string in .env');
}

mongoose.connect(MONGODB_URI).then(
  () => console.log('MongoDB connected'),
  (err) => console.error('MongoDB connection error:', err.message)
);

// ---- schemas ----
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true }, // e.g. "ecommerce", "education"
  apiKeyHash: { type: String, required: true }, // sha256 of the actual key - the raw key is never stored
  createdAt: { type: Date, default: Date.now },
  active: { type: Boolean, default: true },
});
const Product = mongoose.model('Product', productSchema);

const userSchema = new mongoose.Schema({
  product: { type: String, required: true, index: true, lowercase: true, trim: true },
  identifier: { type: String, required: true, lowercase: true, trim: true }, // email or userId, scoped per-product
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  failedAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
});
userSchema.index({ product: 1, identifier: 1 }, { unique: true }); // same identifier can exist in 2 products, not twice in 1
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  product: { type: String, required: true, index: true, lowercase: true, trim: true },
  from: { type: String, required: true, lowercase: true, trim: true, index: true },
  to: { type: String, required: true, lowercase: true, trim: true, index: true },
  ts: { type: Date, default: Date.now },
  subject: { type: Buffer, required: true }, // zlib-compressed
  body: { type: Buffer, required: true },    // zlib-compressed
  flags: { type: Number, default: 0 },       // bit0: read, bit1: used(otp)
});
const Message = mongoose.model('Message', messageSchema);

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Admin = mongoose.model('Admin', adminSchema);

const resetRequestSchema = new mongoose.Schema({
  product: { type: String, required: true, index: true, lowercase: true, trim: true },
  identifier: { type: String, required: true, lowercase: true, trim: true },
  contact: { type: String, default: '' }, // WhatsApp number or other contact info, optional
  status: { type: String, enum: ['pending', 'resolved'], default: 'pending', index: true },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null }, // admin username who handled it
});
const ResetRequest = mongoose.model('ResetRequest', resetRequestSchema);

// ---- compression ----
const deflate = (str) => zlib.deflateRawSync(Buffer.from(str, 'utf8'));
const inflate = (buf) => zlib.inflateRawSync(buf).toString('utf8');

// ---- messages (product-scoped) ----
async function saveMessage({ product, from, to, subject, body }) {
  const doc = await Message.create({
    product: product.trim().toLowerCase(),
    from: from.trim().toLowerCase(),
    to: to.trim().toLowerCase(),
    subject: deflate(subject || ''),
    body: deflate(body || ''),
  });
  return doc._id.toString();
}

async function listInbox(product, identifier) {
  const docs = await Message.find({ product: product.trim().toLowerCase(), to: identifier.trim().toLowerCase() })
    .sort({ ts: -1 })
    .select('_id from ts subject flags')
    .lean();
  return docs.map(d => ({
    id: d._id.toString(),
    from: d.from,
    subject: inflate(Buffer.from(d.subject.buffer || d.subject)),
    ts: Math.floor(new Date(d.ts).getTime() / 1000),
    read: !!(d.flags & 1),
    used: !!(d.flags & 2),
  }));
}

async function getMessage(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const d = await Message.findById(id).lean();
  if (!d) return null;
  return {
    id: d._id.toString(),
    product: d.product,
    from: d.from,
    to: d.to,
    subject: inflate(Buffer.from(d.subject.buffer || d.subject)),
    body: inflate(Buffer.from(d.body.buffer || d.body)),
    ts: Math.floor(new Date(d.ts).getTime() / 1000),
    read: !!(d.flags & 1),
    used: !!(d.flags & 2),
  };
}

async function markRead(id) {
  if (!mongoose.isValidObjectId(id)) return;
  await Message.updateOne({ _id: id }, { $bit: { flags: { or: 1 } } });
}
async function markUsed(id) {
  if (!mongoose.isValidObjectId(id)) return;
  await Message.updateOne({ _id: id }, { $bit: { flags: { or: 2 } } });
}

async function dbSizeBytes() {
  try {
    const stats = await mongoose.connection.db.stats();
    return stats.dataSize;
  } catch {
    return null;
  }
}

// ---- users (auth, product-scoped) ----
async function createUser(product, identifier, passwordHash) {
  return User.create({
    product: product.trim().toLowerCase(),
    identifier: identifier.trim().toLowerCase(),
    passwordHash,
  });
}
async function findUser(product, identifier) {
  return User.findOne({
    product: product.trim().toLowerCase(),
    identifier: identifier.trim().toLowerCase(),
  }).lean();
}
async function updatePassword(product, identifier, passwordHash) {
  await User.updateOne(
    { product: product.trim().toLowerCase(), identifier: identifier.trim().toLowerCase() },
    { passwordHash, failedAttempts: 0, lockedUntil: null }
  );
}
async function recordFailedLogin(product, identifier) {
  product = product.trim().toLowerCase();
  identifier = identifier.trim().toLowerCase();
  const user = await User.findOneAndUpdate(
    { product, identifier },
    { $inc: { failedAttempts: 1 } },
    { new: true }
  );
  if (user && user.failedAttempts >= 5) {
    await User.updateOne({ product, identifier }, { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) });
  }
}
async function clearFailedLogins(product, identifier) {
  await User.updateOne(
    { product: product.trim().toLowerCase(), identifier: identifier.trim().toLowerCase() },
    { failedAttempts: 0 }
  );
}
function isLocked(user) {
  return user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();
}

// ---- products (API keys) ----
async function createProduct(name, apiKeyHash) {
  return Product.create({ name: name.trim().toLowerCase(), apiKeyHash });
}
async function findProductByName(name) {
  return Product.findOne({ name: name.trim().toLowerCase() }).lean();
}
async function findProductByKeyHash(apiKeyHash) {
  return Product.findOne({ apiKeyHash, active: true }).lean();
}

// ---- admins ----
async function createAdmin(username, passwordHash) {
  return Admin.create({ username: username.trim().toLowerCase(), passwordHash });
}
async function findAdmin(username) {
  return Admin.findOne({ username: username.trim().toLowerCase() }).lean();
}

// ---- password reset requests (manual admin-handled flow) ----
async function createResetRequest(product, identifier, contact) {
  const doc = await ResetRequest.create({
    product: product.trim().toLowerCase(),
    identifier: identifier.trim().toLowerCase(),
    contact: contact || '',
  });
  return doc._id.toString();
}
async function listPendingRequests() {
  const docs = await ResetRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
  return docs.map(d => ({
    id: d._id.toString(),
    product: d.product,
    identifier: d.identifier,
    contact: d.contact,
    createdAt: Math.floor(new Date(d.createdAt).getTime() / 1000),
  }));
}
async function getResetRequest(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const d = await ResetRequest.findById(id).lean();
  if (!d) return null;
  return {
    id: d._id.toString(), product: d.product, identifier: d.identifier,
    contact: d.contact, status: d.status,
  };
}
async function resolveResetRequest(id, adminUsername) {
  if (!mongoose.isValidObjectId(id)) return;
  await ResetRequest.updateOne(
    { _id: id },
    { status: 'resolved', resolvedAt: new Date(), resolvedBy: adminUsername }
  );
}

module.exports = {
  saveMessage, listInbox, getMessage, markRead, markUsed, dbSizeBytes,
  createUser, findUser, updatePassword, recordFailedLogin, clearFailedLogins, isLocked,
  createProduct, findProductByName, findProductByKeyHash,
  createAdmin, findAdmin,
  createResetRequest, listPendingRequests, getResetRequest, resolveResetRequest,
};
