#!/usr/bin/env bash
# ============================================================================
# 低模工坊 · Linux / macOS 一键起服务
#
#   ./start.sh                    # 所有网卡（默认；直连 / 局域网都能访问）
#   HOST=127.0.0.1 ./start.sh     # 只给本机（配合 nginx / 宝塔反向代理）
#
# 服务全部零依赖（只用 Node 内置模块），不需要 npm install。
# 开源项目 · 服务端无鉴权：/api/* 可读可写，要保护请在外层反代加。
# ============================================================================
set -e
cd "$(dirname "$0")"

export PORT="${PORT:-8765}"
export HOST="${HOST:-0.0.0.0}"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 没找到 node —— 请先装 Node.js 16+（宝塔：软件商店 → Node.js 版本管理器）" >&2
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 16 ]; then
  echo "✗ Node 版本太低（$major），需要 16+" >&2
  exit 1
fi

echo "低模工坊 → http://${HOST}:${PORT}/"
exec node tools/_serve.js
