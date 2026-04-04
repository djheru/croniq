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
    max_memory_restart: '1G'
  }]
};
