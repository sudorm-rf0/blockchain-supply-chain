#!/usr/bin/env bash
# anchor test 的默认测试入口：默认只跑功能测试，
# 需要 CU 基准时设置 ANCHOR_BENCH=1 追加 compute-units.ts。
set -euo pipefail

cd "$(dirname "$0")/.."

# 独立审计 C-1 回归（伪造 program_data 拒绝）必须最先执行：
# 此时 Pool/Registry PDA 尚未初始化，initialize_* 的 C-1 地址+owner 约束检查先于一切被触发。
FILES=(tests/c1-program-data-regression.ts tests/trade-finance.ts tests/supply-chain.ts)
if [[ "${ANCHOR_BENCH:-0}" == "1" ]]; then
  FILES+=(tests/compute-units.ts)
fi

exec ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 "${FILES[@]}"
