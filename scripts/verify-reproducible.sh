#!/usr/bin/env bash
# 链上字节码一致性验证：对比链上程序字节码哈希与本地可复现构建产物。
# 使第三方可独立验证"链上部署的字节码来自被审计源码"（DFR-0148 建议项）。
#
# 用法：
#   bash scripts/verify-reproducible.sh              # 对比 devnet（默认）
#   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com bash scripts/verify-reproducible.sh
# Env：
#   SOLANA_RPC_URL / TRADE_FINANCE_PROGRAM_ID / SUPPLY_CHAIN_PROGRAM_ID（默认 devnet 占位）
# 前置：先运行 scripts/reproducible-build.sh 生成本地 target/deploy/*.so
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
export PATH="${SOLANA_BIN}:$HOME/.cargo/bin:$PATH"

RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
TRADE_PID="${TRADE_FINANCE_PROGRAM_ID:-9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3}"
SUPPLY_PID="${SUPPLY_CHAIN_PROGRAM_ID:-Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk}"

TRADE_SO="${ROOT}/packages/contracts/target/deploy/trade_finance.so"
SUPPLY_SO="${ROOT}/packages/contracts/target/deploy/supply_chain.so"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

fail=0
compare() {
  local name="$1" pid="$2" local_so="$3"
  local dump="${TMP}/${name}.bin"
  if [[ ! -f "${local_so}" ]]; then
    echo "❌ ${name}: 缺少本地构建产物 ${local_so}（先跑 reproducible-build.sh）"; fail=1; return
  fi
  if ! solana program dump "${pid}" "${dump}" --url "${RPC}" >/dev/null 2>&1; then
    echo "❌ ${name}: 无法从链上 dump（${pid} @ ${RPC}）——可能未部署或 RPC 不可达"; fail=1; return
  fi
  local onchain localh
  onchain="$(shasum -a 256 "${dump}" | cut -d' ' -f1)"
  localh="$(shasum -a 256 "${local_so}" | cut -d' ' -f1)"
  if [[ "${onchain}" == "${localh}" ]]; then
    echo "✅ ${name}: 链上字节码与本地构建一致"
    echo "   链上 sha256: ${onchain}"
  else
    echo "❌ ${name}: 不一致"
    echo "   链上 sha256: ${onchain}"
    echo "   本地 sha256: ${localh}"
    fail=1
  fi
}

echo "==> 链上字节码一致性验证 (${RPC})"
compare "trade_finance" "${TRADE_PID}" "${TRADE_SO}"
compare "supply_chain"  "${SUPPLY_PID}" "${SUPPLY_SO}"
echo "----------------------------------------"
if [[ "${fail}" == "0" ]]; then
  echo "verify-reproducible: PASS（链上字节码 = 本地可复现构建）"
else
  echo "verify-reproducible: FAIL" >&2
  exit 1
fi
