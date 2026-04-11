// Load .env file manually since PM2's env_file doesn't work reliably
require('dotenv/config');

module.exports = {
  apps: [{
    name: 'croniq',
    script: './dist/server.js',
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || '3001',
      DATA_DIR: process.env.DATA_DIR || './data',
      SESSION_SECRET: process.env.SESSION_SECRET,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
      RP_ID: process.env.RP_ID || 'localhost',
      ORIGIN: process.env.ORIGIN || 'http://localhost:5173',
      AWS_REGION: process.env.AWS_REGION,
      COLLECTOR_MODEL_ID: process.env.COLLECTOR_MODEL_ID,
      EDITOR_MODEL_ID: process.env.EDITOR_MODEL_ID
    },
    instances: 1,
    autorestart: true,
    watch: false,
    // Pi has 8GB RAM. The previous 1G limit triggered frequent PM2 restarts
    // when multiple Playwright browser jobs ran concurrently (~300MB each).
    // Each restart loses all in-memory cron schedules, causing missed runs.
    max_memory_restart: '2G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
};
