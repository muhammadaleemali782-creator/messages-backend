const mongoose = require('mongoose');
const zlib = require('zlib');
const uri = 'mongodb+srv://luciferop36_db_user:atIt54yOD2blC1lI@cluster0.2m4wpyj.mongodb.net/messagesdb?appName=Cluster0';

const inflate = (buf) => {
  if (!buf) return '';
  try {
    const rawBuffer = Buffer.isBuffer(buf) ? buf : (buf.buffer ? Buffer.from(buf.buffer) : Buffer.from(buf));
    return zlib.inflateRawSync(rawBuffer).toString('utf8');
  } catch { return ''; }
};

mongoose.connect(uri).then(async () => {
  const messageSchema = new mongoose.Schema({
    product: String, from: String, to: String, ts: Date, subject: Buffer, body: Buffer, flags: Number
  });
  const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

  const allMsgs = await Message.find({}).sort({ ts: 1 }).lean();
  console.log('Total messages before cleanup:', allMsgs.length);

  const seen = new Set();
  const duplicateIds = [];

  for (const m of allMsgs) {
    const timeKey = Math.floor(new Date(m.ts).getTime() / 2000);
    const bodyStr = inflate(m.body);
    const key = `${timeKey}_${bodyStr}`;
    if (seen.has(key)) {
      duplicateIds.push(m._id);
    } else {
      seen.add(key);
    }
  }

  if (duplicateIds.length > 0) {
    await Message.deleteMany({ _id: { $in: duplicateIds } });
    console.log('Deleted duplicate messages count:', duplicateIds.length);
  }

  const remaining = await Message.find({}).lean();
  console.log('Remaining clean messages count:', remaining.length);
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
