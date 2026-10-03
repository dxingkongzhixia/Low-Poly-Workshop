#!/usr/bin/env bash
# ============================================================================
# 低模工坊 · Linux 一键部署（用 systemd 常驻，零依赖、不用装 pm2）
#
#   bash tools/deploy-linux.sh          # 默认端口 8765
#   bash tools/deploy-linux.sh 80       # 换端口（要 root）
#
# 它做四件事：
#   ① 自动找 node（优先宝塔「Node.js版本管理器」里的）
#   ② 写 /etc/systemd/system/lowpoly.service
#   ③ 启动 + 开机自启
#   ④ 自检（systemctl status / curl / ss）
# ============================================================================
set -e
PORT="${1:-8765}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" != "0" ]; then
  echo "✗ 需要 root（systemd 要写 /etc）。用： sudo bash tools/deploy-linux.sh $PORT" >&2
  exit 1
fi

# ① 找 node
NODE="$(ls -d /www/server/nodejs/v*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
[ -z "$NODE" ] && NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "✗ 没找到 node —— 请在宝塔「Node.js版本管理器」装一个版本（18/20/22 都行），或把 node 加进 PATH" >&2
  exit 1
fi
echo "node = $NODE  ($("$NODE" -v))"
echo "root = $ROOT"
echo "port = $PORT"

# ② 写 systemd 单元（ExecStart 必须是 node 的完整路径）
cat >/etc/systemd/system/lowpoly.service <<EOF
[Unit]
Description=Low-Poly Workshop
After=network.target

[Service]
WorkingDirectory=$ROOT
ExecStart=$NODE tools/_serve.js
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

# ③ 启动 + 开机自启
systemctl daemon-reload
systemctl enable --now lowpoly
sleep 1

# ④ 自检
echo "----- systemctl status -----"
systemctl status lowpoly --no-pager | head -6 || true
echo "----- 本机自检 -----"
curl -sI "http://127.0.0.1:$PORT/" | head -1 || true
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep ":$PORT" || true
echo
echo "✓ 完成。"
echo "   重启：systemctl restart lowpoly     停：systemctl stop lowpoly     日志：journalctl -u lowpoly -f"
echo "   公网：在机房面板把「公网端口 → 内网 $PORT」映射好（例 10356 → $PORT），再开 http://<公网IP>:<公网端口>/"
echo "   注意：部分共享 IP 机房只放行 80/443/888 这类 Web 端口 —— 那种情况用 $PORT=80 或走宝塔站点反代。"
