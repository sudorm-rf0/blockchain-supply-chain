#!/usr/bin/env bash
# 链上/DB 对账（cron 可调用）：发现差异退出码 1，供告警。
# 用法：SOLANA_RPC_URL=... DATABASE_URL=... TRADE_FINANCE_PROGRAM_ID=... \
#       USDC_MINT=... bash scripts/reconcile.sh [--json]
# 可定时：0 * * * * bash /path/scripts/reconcile.sh >/tmp/reconcile.log 2>&1 || curl -fsS <告警webhook> -d "对账失败"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${SOLANA_RPC_URL:?需要 SOLANA_RPC_URL}"
: "${DATABASE_URL:?需要 DATABASE_URL}"
: "${TRADE_FINANCE_PROGRAM_ID:?需要 TRADE_FINANCE_PROGRAM_ID}"
node "${ROOT}/scripts/reconcile.mjs" "$@"
