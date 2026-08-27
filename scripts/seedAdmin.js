require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://luciferop36_db_user:atIt54yOD2blC1lI@cluster0.2m4wpyj.mongodb.net/messagesdb?appName=Cluster0';

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to mail server MongoDB database (messagesdb)!');

    const userSchema = new mongoose.Schema({
      product: { type: String, required: true, lowercase: true, trim: true },
      identifier: { type: String, required: true, lowercase: true, trim: true },
      displayName: { type: String, default: '', trim: true },
      passwordHash: { type: String, required: true },
      phone: { type: String, default: '' },
      createdAt: { type: Date, default: Date.now },
      failedAttempts: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
    });
    userSchema.index({ product: 1, identifier: 1 }, { unique: true });
    const User = mongoose.models.User || mongoose.model('User', userSchema);

    const productSchema = new mongoose.Schema({
      name: { type: String, required: true, unique: true, trim: true },
      apiKeyHash: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
      active: { type: Boolean, default: true },
    });
    const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

    // Ensure default products exist
    const crypto = require('crypto');
    const defaultApiKey = 'educa_master_api_key_secret_2026';
    const apiKeyHash = crypto.createHash('sha256').update(defaultApiKey).digest('hex');

    const prodNames = ['educa', 'ecommerce'];
    for (const pName of prodNames) {
      const prod = await Product.findOne({ name: pName });
      if (!prod) {
        await Product.create({ name: pName, apiKeyHash, active: true });
        console.log(`✅ Created Product: ${pName}`);
      }
    }

    // Seed Admin Accounts
    const hash = await bcrypt.hash('12345', 12);
    const adminIdentifiers = [
      'admin@gmail.com',
      'admin',
      'admin@educaveda.com',
      'admin@educa.com'
    ];

    for (const id of adminIdentifiers) {
      for (const prod of ['educa', 'ecommerce']) {
        const found = await User.findOne({ product: prod, identifier: id.toLowerCase() });
        if (!found) {
          await User.create({
            product: prod,
            identifier: id.toLowerCase(),
            displayName: 'System Admin',
            passwordHash: hash,
            phone: '',
            failedAttempts: 0,
            lockedUntil: null
          });
          console.log(`✅ Created Admin user: [${prod}] ${id}`);
        } else {
          await User.updateOne(
            { _id: found._id },
            { passwordHash: hash, failedAttempts: 0, lockedUntil: null }
          );
          console.log(`✅ Updated Admin user password (12345): [${prod}] ${id}`);
        }
      }
    }

    console.log('\n🎉 ALL ADMIN ACCOUNTS ARE NOW ACTIVE & READY FOR LOGIN!');
    console.log('   Identifier: admin@gmail.com / admin / admin@educaveda.com');
    console.log('   Password: 12345\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
    process.exit(1);
  }
}

seed();
