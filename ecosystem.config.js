/* ============================================================================
 * PM2 配置 —— 低模工坊（零依赖，不需要 npm install）
 *
 *   pm2 start ecosystem.config.js     # 起
 *   pm2 save                          # 记住，开机自启（配合 pm2 startup）
 *   pm2 logs lowpoly-workshop         # 看日志
 *   pm2 restart lowpoly-workshop
 *
 * 公网部署务必打开鉴权（下面 env 里填，或先在 shell 里 export 再 pm2 start）：
 *   AUTH_USER=admin AUTH_PASS='你的密码' pm2 start ecosystem.config.js
 * ========================================================================== */
module.exports = {
  apps: [{
    name: 'lowpoly-workshop',
    script: 'tools/_serve.js',
    cwd: __dirname,
    env: {
      PORT:      process.env.PORT      || 8765,
      HOST:      process.env.HOST      || '127.0.0.1',   // 只给反代用；直连改 0.0.0.0
      AUTH_USER: process.env.AUTH_USER || '',
      AUTH_PASS: process.env.AUTH_PASS || '',
    },
    autorestart: true,
    max_memory_restart: '512M',
  }],
};
