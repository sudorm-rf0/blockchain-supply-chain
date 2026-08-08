#!/usr/bin/env bash
# 多签迁移演练编排：启动 validator（test.sh 参数）-> 部署合约 test-build -> Part 2 迁移演练
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/active_release/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LEDGER="$ROOT/packages/contracts/.anchor/test-ledger"
RPC_PORT=8899

# 清理
pkill -f "solana-test-validator.*${LEDGER}" 2>/dev/null || true
tmux kill-server 2>/dev/null || true
rm -rf "$LEDGER"

# 构建 test-build（先移走旧 .so 避免缓存）
cd "$ROOT/packages/contracts"
for so in target/deploy/trade_finance.so target/deploy/supply_chain.so; do
  [[ -f "$so" ]] && mv "$so" "$so.pre.$$"
done
cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml --arch v3 --features test-build >/dev/null
cargo build-sbf --manifest-path programs/supply-chain/Cargo.toml --arch v3 --features test-build >/dev/null

# 启动 validator
tmux new-session -d -s rehearsal "solana-test-validator --reset --quiet --ledger $LEDGER --rpc-port $RPC_PORT > /tmp/rehearsal-v.log 2>&1"
for i in $(seq 1 120); do
  curl -sf "http://127.0.0.1:${RPC_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:${RPC_PORT}/health" >/dev/null || { echo "validator 启动失败"; tail -20 /tmp/rehearsal-v.log; exit 1; }
solana config set --url "http://127.0.0.1:${RPC_PORT}" >/dev/null
solana airdrop 10 >/dev/null 2>&1 || true

# 部署合约（UA=默认钱包）
echo "==> 部署合约"
solana program deploy target/deploy/trade_finance.so --program-id target/deploy/trade_finance-keypair.json >/dev/null
solana program deploy target/deploy/supply_chain.so --program-id target/deploy/supply_chain-keypair.json >/dev/null
echo "==> 合约已部署，开始迁移演练"
cd "$ROOT/scripts/multisig-rehearsal"
RPC="http://127.0.0.1:${RPC_PORT}" node rehearsal-admin-migration.mjs
RESULT=$?
tmux kill-server 2>/dev/null || true
exit $RESULT
