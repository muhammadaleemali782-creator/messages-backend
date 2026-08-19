// scripts/create-product.js
// Usage: node scripts/create-product.js ecommerce
require('dotenv').config();
const { createProduct } = require('../src/apiKey');

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/create-product.js <product-name>');
  console.error('Example: node scripts/create-product.js ecommerce');
  process.exit(1);
}

createProduct(name)
  .then((rawKey) => {
    console.log(`\nProduct "${name}" created.`);
    console.log(`API key (save this now, it will not be shown again):\n`);
    console.log(`  ${rawKey}\n`);
    console.log(`Put this in your "${name}" backend's .env as MESSAGES_API_KEY, never in frontend code.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed to create product:', err.message);
    process.exit(1);
  });
