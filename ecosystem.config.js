/* ============================================================================
 * PM2 配置 —— 低模工坊（零依赖，不需要 npm install）
 *
 *   pm2 start ecosystem.config.js     # 起
 *   pm2 save                          # 记住，开机自启（配合 pm2 startup）
 *   pm2 logs lowpoly-workshop         # 看日志
 *   pm2 restart lowpoly-workshop
 *
 * 开源项目 · 服务端无鉴权。绑哪个地址用 HOST 控制：
 *   HOST=0.0.0.0（默认，所有网卡） / HOST=127.0.0.1（只给本机 / 反代）
 * ========================================================================== */
module.exports = {
  apps: [{
    name: 'lowpoly-workshop',
    script: 'tools/_serve.js',
    cwd: __dirname,
    env: {
      PORT: process.env.PORT || 8765,
      HOST: process.env.HOST || '0.0.0.0',
    },
    autorestart: true,
    max_memory_restart: '512M',
  }],
};
