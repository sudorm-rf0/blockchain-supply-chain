#!/usr/bin/env bash
# 运行环境密钥泄露守卫（审计 2026-09-12）
#
# 背景：NEXT_PUBLIC_* 变量会被 Next.js 打包进浏览器 bundle（公网可见）。
# 曾发生 NEXT_PUBLIC_RPC_URL 携带 Helius API Key 被暴露到前端的事故；
# scan-secrets.sh 只扫仓库与 git 历史，扫不到服务器上的运行时 .env 文件，
# 因此本脚本专门检查「运行时环境文件」中的公开变量。
#
# 用法: bash scripts/check-public-env-secrets.sh [env 文件...]
#   默认检查: deploy/vps/.env.app  /etc/supply-chain-alert.env  /etc/supply-chain-ai.env
set -uo pipefail

FILES=("$@")
if [ "${#FILES[@]}" -eq 0 ]; then
  FILES=(
    "deploy/vps/.env.app"
    "/opt/supply-chain/deploy/vps/.env.app"
    "/etc/supply-chain-alert.env"
    "/etc/supply-chain-ai.env"
  )
fi

# 公开变量中出现这些模式即视为泄露
DANGEROUS=(
  'api-key='
  'apikey='
  'api_key='
  'token='
  'secret='
  'password='
  'passwd='
)

fail=0
checked=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  checked=$((checked + 1))
  while IFS= read -r line; do
    # 只关心公开变量（NEXT_PUBLIC_*）
    case "$line" in
      NEXT_PUBLIC_*) ;;
      *) continue ;;
    esac
    lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
    for pat in "${DANGEROUS[@]}"; do
      if printf '%s' "$lower" | grep -q -- "$pat"; then
        # 允许空值
        val="$(printf '%s' "$line" | cut -d= -f2- | tr -d ' "'"'"'')"
        if [ -n "$val" ]; then
          echo "❌ 公开变量疑似携带密钥: $f"
          echo "   $(printf '%s' "$line" | sed -E 's/(key=|token=|secret=|password=)[^&"'"'"' ]+/\1***/gi')"
          fail=1
        fi
      fi
    done
  done < "$f"
done

if [ "$fail" = "1" ]; then
  echo ""
  echo "❌ 检测到 NEXT_PUBLIC_* 公开变量携带密钥（会被打包进前端，公网可见）。"
  echo "   修复：把带 Key 的地址放到后端专用变量（如 SOLANA_RPC_URL），前端用公共无 Key 端点。"
  exit 1
fi

echo "✅ 公开环境变量检查通过（检查了 $checked 个环境文件，无密钥泄露）"
exit 0
