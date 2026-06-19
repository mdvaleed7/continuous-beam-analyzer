// PM2 process manager config for production deployment.
//
// Previous version hardcoded cwd: '/home/user/webapp' — a path that existed
// only on one developer's machine. The path is now relative to this file's
// directory so the config is portable.
//
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 logs beam-app
//   pm2 stop beam-app
//
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'beam-app',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 0.0.0.0',
      cwd: __dirname,
      env: { NODE_ENV: 'production', PORT: 3000 },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
};
