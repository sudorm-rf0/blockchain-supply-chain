#!/usr/bin/env bash
# 多签迁移演练编排：启动 validator（test.sh 参数）-> 部署合约 test-build -> Part 2 迁移演练
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/active_release/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# 审计 M-04（第三轮）：路径自适应 —— 真实仓库布局 packages/contracts，
# 审计包布局 contracts/，两者均可直接执行。
if [[ -d "${ROOT}/packages/contracts" ]]; then
  CONTRACTS_DIR="${ROOT}/packages/contracts"
else
  CONTRACTS_DIR="${ROOT}/contracts"
fi
LEDGER="${CONTRACTS_DIR}/.anchor/test-ledger"
RPC_PORT=8899

# 清理
pkill -f "solana-test-validator.*${LEDGER}" 2>/dev/null || true
tmux kill-server 2>/dev/null || true
rm -rf "$LEDGER"

# 构建 test-build（先移走旧 .so 避免缓存）
cd "${CONTRACTS_DIR}"
for so in target/deploy/trade_finance.so target/deploy/supply_chain.so; do
  [[ -f "$so" ]] && mv "$so" "$so.pre.$$"
done
cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml --arch v3 --features test-build >/dev/null
cargo build-sbf --manifest-path programs/supply-chain/Cargo.toml --arch v3 --features test-build >/dev/null

# 启动 validator（--clone 拉取真实 Squads v4 程序 + ProgramData PDA，供 H-1 正路径演练；
# 仅克隆 program account 不够，字节码在 ProgramData，必须一并克隆，否则 "Program is not deployed"）。
SQUADS_PROGRAM_ID="SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
SQUADS_PROGRAM_DATA="Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n"
# devnet ProgramConfig（已初始化；authority=HM5y4mz... 为 devnet 部署方）
SQUADS_PROGRAM_CONFIG="BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr"
CLONE_ARGS=""
if solana-test-validator --help 2>&1 | grep -q -- "--clone"; then
  CLONE_ARGS="--clone ${SQUADS_PROGRAM_ID} --clone ${SQUADS_PROGRAM_DATA} --clone ${SQUADS_PROGRAM_CONFIG} --url https://api.devnet.solana.com"
fi
tmux new-session -d -s rehearsal "solana-test-validator --reset --quiet --ledger $LEDGER --rpc-port $RPC_PORT $CLONE_ARGS > /tmp/rehearsal-v.log 2>&1"
for i in $(seq 1 120); do
  curl -sf "http://127.0.0.1:${RPC_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:${RPC_PORT}/health" >/dev/null || { echo "validator 启动失败"; tail -20 /tmp/rehearsal-v.log; exit 1; }
solana config set --url "http://127.0.0.1:${RPC_PORT}" >/dev/null
solana airdrop 10 >/dev/null 2>&1 || true

# 验证 Squads 程序是否已 clone（H-1 正路径前置）
SQUADS_PROGRAM_ID="SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
if solana program show "${SQUADS_PROGRAM_ID}" --url "http://127.0.0.1:${RPC_PORT}" >/dev/null 2>&1; then
  echo "✅ Squads 程序已加载（--clone 生效）"
else
  echo "⚠️ Squads 程序未加载（--clone 拉取失败？H-1 正路径将跳过）" >&2
fi

# 部署合约（UA=默认钱包）
echo "==> 部署合约"
solana program deploy target/deploy/trade_finance.so --program-id target/deploy/trade_finance-keypair.json >/dev/null
solana program deploy target/deploy/supply_chain.so --program-id target/deploy/supply_chain-keypair.json >/dev/null
echo "==> 合约已部署，开始迁移演练"
cd "$ROOT/scripts/multisig-rehearsal"
RPC="http://127.0.0.1:${RPC_PORT}" node rehearsal-admin-migration.mjs
MIG_RESULT=$?
echo "==> H-1 正路径演练（真实 Squads VaultTransaction）"
RPC="http://127.0.0.1:${RPC_PORT}" node h1-positive-path-local.mjs
H1_RESULT=$?
tmux kill-server 2>/dev/null || true
if [[ "${MIG_RESULT}" != "0" || "${H1_RESULT}" != "0" ]]; then
  echo "❌ 演练失败：migration=${MIG_RESULT} h1-positive=${H1_RESULT}" >&2
  exit 1
fi
echo "✅ 全部演练通过（admin 迁移 + H-1 正路径）"
exit 0
