const mongoose = require('mongoose');

const STORE_MONGO_URI = 'mongodb+srv://muhammadaleemali782_db_user:ZtZFX6qxG60acCwn@cluster0.yfst7qm.mongodb.net/ecommerce?retryWrites=true&w=majority&appName=Cluster0';
const MAIL_MONGO_URI = 'mongodb+srv://luciferop36_db_user:atIt54yOD2blC1lI@cluster0.2m4wpyj.mongodb.net/messagesdb?appName=Cluster0';

async function syncAllUsers() {
  console.log('Connecting to databases...');
  const storeConn = await mongoose.createConnection(STORE_MONGO_URI).asPromise();
  const mailConn = await mongoose.createConnection(MAIL_MONGO_URI).asPromise();
  console.log('Both databases connected!');

  const storeUserSchema = new mongoose.Schema({}, { strict: false });
  const StoreUser = storeConn.model('User', storeUserSchema, 'users');

  const mailUserSchema = new mongoose.Schema({
    product: String,
    identifier: String,
    displayName: String,
    passwordHash: String,
    phone: String,
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null }
  });
  const MailUser = mailConn.model('User', mailUserSchema, 'users');

  const storeUsers = await StoreUser.find({}).lean();
  console.log(`Found ${storeUsers.length} users in EDUCA Store database.`);

  let syncedCount = 0;

  for (const u of storeUsers) {
    const pHash = u.password;
    if (!pHash) continue;

    const displayName = u.fullName || u.name || 'User';
    const phone = u.phone || '';

    // 1. Sync by email
    if (u.email) {
      const emailId = u.email.trim().toLowerCase();
      await MailUser.findOneAndUpdate(
        { identifier: emailId },
        {
          product: 'educa',
          identifier: emailId,
          displayName,
          passwordHash: pHash,
          phone,
          failedAttempts: 0,
          lockedUntil: null
        },
        { upsert: true, new: true }
      );
      syncedCount++;
    }

    // 2. Sync by userId (e.g. DS001)
    if (u.userId) {
      const userCode = u.userId.trim().toLowerCase();
      await MailUser.findOneAndUpdate(
        { identifier: userCode },
        {
          product: 'educa',
          identifier: userCode,
          displayName,
          passwordHash: pHash,
          phone,
          failedAttempts: 0,
          lockedUntil: null
        },
        { upsert: true, new: true }
      );
      syncedCount++;
    }
  }

  console.log(`✅ Successfully synced ${syncedCount} identities into EDUCA Mail Server!`);
  await storeConn.close();
  await mailConn.close();
  process.exit(0);
}

syncAllUsers().catch(err => {
  console.error('Sync error:', err);
  process.exit(1);
});
