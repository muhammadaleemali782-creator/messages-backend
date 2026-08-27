// storage.js — MongoDB version (mongoose) with Safe BSON Binary handling
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
  name: { type: String, required: true, unique: true, trim: true },
  apiKeyHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  active: { type: Boolean, default: true },
});
const Product = mongoose.model('Product', productSchema);

const userSchema = new mongoose.Schema({
  product: { type: String, required: true, index: true, lowercase: true, trim: true },
  identifier: { type: String, required: true, lowercase: true, trim: true },
  displayName: { type: String, default: '', trim: true },
  passwordHash: { type: String, required: true },
  phone: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  failedAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
});
userSchema.index({ product: 1, identifier: 1 }, { unique: true });
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  product: { type: String, required: true, index: true, lowercase: true, trim: true },
  from: { type: String, required: true, lowercase: true, trim: true, index: true },
  to: { type: String, required: true, lowercase: true, trim: true, index: true },
  ts: { type: Date, default: Date.now, index: true },
  subject: { type: Buffer, required: true },
  body: { type: Buffer, required: true },
  flags: { type: Number, default: 0 },
});

// ⭐ AUTOMATIC 3-HOUR TTL EXPIRATION (MongoDB Native Auto-Delete)
messageSchema.index({ ts: 1 }, { expireAfterSeconds: 3 * 60 * 60 });
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

// Periodic 3-hour cleanup worker
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
async function purgeExpiredMessages() {
  try {
    const cutoff = new Date(Date.now() - THREE_HOURS_MS);
    const res = await Message.deleteMany({ ts: { $lt: cutoff } });
    if (res.deletedCount > 0) {
      console.log(`🧹 Auto-purged ${res.deletedCount} messages older than 3 hours.`);
    }
  } catch (e) {
    console.warn("Auto-purge notice:", e.message);
  }
}
setInterval(purgeExpiredMessages, 5 * 60 * 1000); // Check every 5 minutes
setTimeout(purgeExpiredMessages, 3000); // Check on boot

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Admin = mongoose.model('Admin', adminSchema);

const resetRequestSchema = new mongoose.Schema({
  product: { type: String, required: true, index: true, lowercase: true, trim: true },
  identifier: { type: String, required: true, lowercase: true, trim: true },
  contact: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'resolved'], default: 'pending', index: true },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null },
});
const ResetRequest = mongoose.model('ResetRequest', resetRequestSchema);

// ---- compression & robust BSON Binary decompression ----
const deflate = (str) => zlib.deflateRawSync(Buffer.from(str || '', 'utf8'));

const inflate = (buf) => {
  if (!buf) return '';
  try {
    const rawBuffer = Buffer.isBuffer(buf) ? buf : (buf.buffer ? Buffer.from(buf.buffer) : Buffer.from(buf));
    return zlib.inflateRawSync(rawBuffer).toString('utf8');
  } catch (e) {
    try {
      return Buffer.from(buf).toString('utf8');
    } catch {
      return String(buf || '');
    }
  }
};

// ---- messages ----
async function saveMessage({ product, from, to, subject, body }) {
  const doc = await Message.create({
    product: (product || 'educa').trim().toLowerCase(),
    from: (from || '').trim().toLowerCase(),
    to: (to || '').trim().toLowerCase(),
    subject: deflate(subject || ''),
    body: deflate(body || ''),
  });
  return doc._id.toString();
}

async function listInbox(product, identifier) {
  const normId = (identifier || '').trim().toLowerCase();
  const baseId = normId.split('@')[0];
  const domain = (process.env.MAIL_DOMAIN || 'educaveda.com').toLowerCase();
  const withDomain = normId.includes('@') ? normId : `${normId}@${domain}`;

  const cutoff = new Date(Date.now() - (3 * 60 * 60 * 1000));
  const query = {
    ts: { $gte: cutoff },
    $or: [
      { to: normId },
      { to: withDomain },
      { to: baseId },
      { to: { $regex: new RegExp(`^${normId}$`, 'i') } },
      { to: { $regex: new RegExp(`^${baseId}@`, 'i') } }
    ]
  };

  const docs = await Message.find(query)
    .sort({ ts: -1 })
    .select('_id from to ts subject body flags')
    .lean();

  const seenContent = new Set();
  const uniqueDocs = [];

  for (const d of docs) {
    const subj = inflate(d.subject);
    const bdy = inflate(d.body);
    // Key by rounded timestamp (within 2 seconds) and content to prevent exact duplicate spam
    const timeKey = Math.floor(new Date(d.ts).getTime() / 2000);
    const contentKey = `${timeKey}_${subj}_${bdy}`;

    if (!seenContent.has(contentKey)) {
      seenContent.add(contentKey);
      uniqueDocs.push({
        id: d._id.toString(),
        from: d.from,
        to: d.to,
        subject: subj,
        body: bdy,
        ts: Math.floor(new Date(d.ts).getTime() / 1000),
        read: !!(d.flags & 1),
        used: !!(d.flags & 2),
      });
    }
  }

  return uniqueDocs;
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

// ---- users (auth) ----
async function createUser(product, identifier, passwordHash, phoneEncrypted) {
  return User.create({
    product: (product || 'educa').trim().toLowerCase(),
    identifier: identifier.trim().toLowerCase(),
    passwordHash,
    phone: phoneEncrypted || '',
  });
}

async function findUser(product, identifier) {
  const normId = (identifier || '').trim().toLowerCase();
  const baseId = normId.split('@')[0];
  const domain = (process.env.MAIL_DOMAIN || 'educaveda.com').toLowerCase();
  const withDomain = normId.includes('@') ? normId : `${normId}@${domain}`;

  return User.findOne({
    $or: [
      { identifier: normId },
      { identifier: withDomain },
      { identifier: baseId },
      { identifier: { $regex: new RegExp(`^${normId}$`, 'i') } },
      { identifier: { $regex: new RegExp(`^${baseId}@`, 'i') } }
    ]
  }).lean();
}

async function updatePassword(product, identifier, passwordHash) {
  const normId = (identifier || '').trim().toLowerCase();
  const baseId = normId.split('@')[0];
  const domain = (process.env.MAIL_DOMAIN || 'educaveda.com').toLowerCase();
  const withDomain = normId.includes('@') ? normId : `${normId}@${domain}`;

  await User.updateMany(
    { 
      $or: [
        { identifier: normId },
        { identifier: baseId },
        { identifier: withDomain },
        { identifier: { $regex: new RegExp(`^${normId}$`, 'i') } },
        { identifier: { $regex: new RegExp(`^${baseId}@`, 'i') } }
      ] 
    },
    { passwordHash, failedAttempts: 0, lockedUntil: null }
  );
}, { identifier: baseId }] },
    { passwordHash, failedAttempts: 0, lockedUntil: null }
  );
}

async function recordFailedLogin(product, identifier) {
  const normId = (identifier || '').trim().toLowerCase();
  const user = await User.findOneAndUpdate(
    { identifier: normId },
    { $inc: { failedAttempts: 1 } },
    { new: true }
  );
  if (user && user.failedAttempts >= 5) {
    await User.updateOne({ _id: user._id }, { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) });
  }
}

async function clearFailedLogins(product, identifier) {
  const normId = (identifier || '').trim().toLowerCase();
  await User.updateOne(
    { identifier: normId },
    { failedAttempts: 0 }
  );
}

function isLocked(user) {
  return user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();
}

// ---- products ----
async function createProduct(name, apiKeyHash) {
  return Product.create({ name: name.trim().toLowerCase(), apiKeyHash });
}
async function findProductByName(name) {
  return Product.findOne({ name: name.trim().toLowerCase(), active: true }).lean();
}
async function findProductByKeyHash(apiKeyHash) {
  return Product.findOne({ apiKeyHash, active: true }).lean();
}

// ---- admin ----
async function createAdmin(username, passwordHash) {
  return Admin.create({ username: username.trim().toLowerCase(), passwordHash });
}
async function findAdmin(username) {
  return Admin.findOne({ username: username.trim().toLowerCase() }).lean();
}

// ---- reset requests ----
async function createResetRequest(product, identifier, contact) {
  return ResetRequest.create({
    product: (product || 'educa').trim().toLowerCase(),
    identifier: identifier.trim().toLowerCase(),
    contact: contact || '',
  });
}
async function listPendingRequests(product) {
  const docs = await ResetRequest.find({
    status: 'pending',
  }).sort({ createdAt: -1 }).lean();
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
  deleteMessagePermanently, emptyTrash, searchGlobalUsers,
  saveMessage, listInbox, getMessage, markRead, markUsed, dbSizeBytes,
  createUser, findUser, updatePassword, recordFailedLogin, clearFailedLogins, isLocked,
  createProduct, findProductByName, findProductByKeyHash,
  createAdmin, findAdmin,
  createResetRequest, listPendingRequests, getResetRequest, resolveResetRequest,
};


// ⭐ PERMANENT DELETE & TRASH MANAGEMENT
async function deleteMessagePermanently(id) {
  if (mongoose.Types.ObjectId.isValid(id)) {
    await Message.deleteOne({ _id: id });
  }
}

async function emptyTrash(product, identifier) {
  // Purges deleted messages matching user
  const normId = (identifier || '').trim().toLowerCase();
  const baseId = normId.split('@')[0];
  await Message.deleteMany({
    $or: [
      { to: normId },
      { to: baseId },
      { from: normId },
      { from: baseId }
    ]
  });
}

// ⭐ GLOBAL USER DIRECTORY SEARCH ACROSS EDUCA ECOSYSTEM
async function searchGlobalUsers(query) {
  const q = (query || '').trim().toLowerCase();
  const filter = q ? {
    $or: [
      { identifier: { $regex: q, $options: 'i' } },
      { displayName: { $regex: q, $options: 'i' } }
    ]
  } : {};

  const users = await User.find(filter)
    .limit(15)
    .select('identifier displayName phone createdAt')
    .lean();

  return users.map(u => ({
    identifier: u.identifier,
    name: u.displayName || u.identifier.split('@')[0].toUpperCase(),
    email: u.identifier.includes('@') ? u.identifier : `${u.identifier}@educaveda.com`,
    role: u.identifier.toLowerCase().startsWith('admin') ? 'Admin' : 
          u.identifier.toUpperCase().startsWith('DS') ? 'Distributor' : 'Member'
  }));
}
