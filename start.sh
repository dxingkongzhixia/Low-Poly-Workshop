#!/usr/bin/env bash
# ============================================================================
# 低模工坊 · Linux / macOS 一键起服务
#
#   ./start.sh                          # 本机（只绑 127.0.0.1，给反代用）
#   HOST=0.0.0.0 ./start.sh             # 直连 / 局域网
#   AUTH_USER=admin AUTH_PASS=xxx ./start.sh   # 打开 Basic Auth（公网务必开）
#
# 服务全部零依赖（只用 Node 内置模块），不需要 npm install。
# ============================================================================
set -e
cd "$(dirname "$0")"

export PORT="${PORT:-8765}"
export HOST="${HOST:-127.0.0.1}"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 没找到 node —— 请先装 Node.js 16+（宝塔：软件商店 → Node.js 版本管理器）" >&2
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 16 ]; then
  echo "✗ Node 版本太低（$major），需要 16+" >&2
  exit 1
fi

if [ -z "$AUTH_USER" ] || [ -z "$AUTH_PASS" ]; then
  echo "⚠ 没设 AUTH_USER / AUTH_PASS —— 服务无鉴权，只建议本机 / 内网访问。"
fi

echo "低模工坊 → http://${HOST}:${PORT}/"
exec node tools/_serve.js
