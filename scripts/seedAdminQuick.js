const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const uri = 'mongodb+srv://luciferop36_db_user:atIt54yOD2blC1lI@cluster0.2m4wpyj.mongodb.net/messagesdb?appName=Cluster0';

mongoose.connect(uri).then(async () => {
  const userSchema = new mongoose.Schema({
    product: String, identifier: String, displayName: String, passwordHash: String, phone: String, failedAttempts: Number, lockedUntil: Date
  });
  const User = mongoose.models.User || mongoose.model('User', userSchema);

  const hash = await bcrypt.hash('12345', 12);
  const admins = ['admin@gmail.com', 'admin', 'admin@educaveda.com'];

  for (const id of admins) {
    await User.findOneAndUpdate(
      { identifier: id },
      { product: 'educa', identifier: id, displayName: 'Admin', passwordHash: hash, failedAttempts: 0, lockedUntil: null },
      { upsert: true, new: true }
    );
    console.log('Admin account ready & unlocked:', id);
  }

  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
