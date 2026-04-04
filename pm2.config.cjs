module.exports = {
  apps: [{
    name: 'croniq',
    script: './dist/server.js',
    env: {
      NODE_ENV: 'production'
    },
    env_file: '.env',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
};
