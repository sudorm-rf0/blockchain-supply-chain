#!/usr/bin/env bash
# anchor test 的默认测试入口：默认只跑功能测试，
# 需要 CU 基准时设置 ANCHOR_BENCH=1 追加 compute-units.ts。
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(tests/trade-finance.ts tests/supply-chain.ts)
if [[ "${ANCHOR_BENCH:-0}" == "1" ]]; then
  FILES+=(tests/compute-units.ts)
fi

exec ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 "${FILES[@]}"
