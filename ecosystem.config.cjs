module.exports = {
  apps: [{
    name: 'chackerblog',
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    instances: 'max',              // Use all available CPU cores
    exec_mode: 'cluster',         // Enable clustering
    autorestart: true,
    watch: false,                 // Disable watch in production
    max_memory_restart: '1G',     // Restart if memory exceeds 1GB
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};