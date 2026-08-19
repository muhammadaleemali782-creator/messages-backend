// scripts/create-admin.js
// Usage: node scripts/create-admin.js <username>
// Prompts for password separately so it never sits in shell history.
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcrypt');
const storage = require('../src/storage');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/create-admin.js <username>');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Set a password for this admin (min 8 chars): ', async (password) => {
  rl.close();
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    await storage.createAdmin(username, hash);
    console.log(`\nAdmin "${username}" created. Login at /admin.html with this username and password.`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin:', err.message);
    process.exit(1);
  }
});
