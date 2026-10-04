#!/usr/bin/env bash
# 开发态：同时起 server + 网页。只依赖本机已装的 Bun，不绑 Homebrew / pipx。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.bun/bin:/usr/bin:/bin:${PATH}"
if ! command -v bun >/dev/null 2>&1; then
  echo "这台机器还没有 Bun。打开 https://bun.sh 安装后再跑。"
  exit 1
fi
cd "$ROOT"
bun install
exec bun run dev
