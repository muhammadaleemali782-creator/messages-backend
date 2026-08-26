// config.js
// This system now runs as a single fixed product ("Educa") instead of the
// earlier multi-product dropdown. Changing PRODUCT_NAME/PRODUCT_DOMAIN here
// (via .env) is the only place needed if this is ever repurposed - nothing
// else in the codebase should hardcode "educa" directly.
module.exports = {
  PRODUCT: process.env.PRODUCT_NAME || 'educa',
  DOMAIN: process.env.PRODUCT_DOMAIN || 'educa.com',
};
