#!/usr/bin/env bash
# 换机器也能跑：用项目里的依赖和自带 ffmpeg / yt-dlp，不读开发机 PATH。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.bun/bin:/usr/bin:/bin:${PATH}"
if ! command -v bun >/dev/null 2>&1; then
  echo "这台机器还没有 Bun。打开 https://bun.sh 安装后再跑。"
  exit 1
fi
cd "$ROOT"
bun install
bun run --filter @vw/web build
cd "$ROOT/apps/server"
exec bun src/index.ts
