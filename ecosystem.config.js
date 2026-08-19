// ecosystem.config.js
// PM2 cluster mode for the HTTP API: runs multiple worker processes and PM2
// load-balances requests across them (round-robin) on the same port.
//
// The SMTP receiver (receive.js) is NOT clustered here on purpose — multiple
// processes can't share port 25 the way HTTP can share a port via PM2's
// cluster mode, and a single receiver is enough since inbound mail volume
// is normally far lower than API traffic. If you outgrow that, put a
// dedicated MTA (Postfix) in front instead of scaling receive.js.
//
// Usage:
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 status / pm2 logs / pm2 monit

module.exports = {
  apps: [
    {
      name: 'mail-api',
      script: './index.js',
      instances: 'max',       // one worker per CPU core
      exec_mode: 'cluster',   // PM2 load-balances across them
      env: {
        NODE_ENV: 'production',
        RUN_MODE: 'api-only', // see index.js - workers only run the HTTP API, not SMTP
      },
    },
    {
      name: 'mail-receiver',
      script: './index.js',
      instances: 1,            // single instance - owns port 25
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        RUN_MODE: 'receiver-only',
      },
    },
  ],
};
