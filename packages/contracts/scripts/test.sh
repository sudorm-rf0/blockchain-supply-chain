#!/usr/bin/env bash
# 测试入口（CI 与本地共用）。
#
# 审计 H-2：已根除 test-deployer / DEPLOYER 白名单。
# 测试程序由本脚本以当前钱包（~/.config/solana/id.json = provider.wallet）作为
# upgrade authority 用 `solana program deploy` 部署（保留 UA），initialize_*
# 校验 UA == admin 即通过 —— 无任何白名单回退路径。
# feature `test-build` 仅放宽 initialize_* 的 initial_delay 下限（验证治理时锁）。
set -euo pipefail

SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"
if [ -d "$SOLANA_BIN" ] || [ -d "$CARGO_BIN" ]; then
  export PATH="$CARGO_BIN:$SOLANA_BIN:$PATH"
fi

# macOS bsdtar writes AppleDouble (._*) entries into genesis.tar.bz2, which
# the validator's ledger unpack check rejects with a "blockstore error".
export COPYFILE_DISABLE=1

cd "$(dirname "$0")/.."

LEDGER_DIR=".anchor/test-ledger"
RPC_PORT="${RPC_PORT:-8899}"

bash scripts/clean-test-ledger.sh
mkdir -p "$(dirname "$LEDGER_DIR")"
mkdir -p "$HOME/.config/solana"
if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
  solana-keygen new --force --no-bip39-passphrase -o "$HOME/.config/solana/id.json" >/dev/null
fi

echo "test: building programs (anchor build + cargo build-sbf v3)"
# anchor build 生成 IDL/keypair；cargo build-sbf --arch v3 生成 validator 可部署的 SBFv3 字节码
anchor build >/dev/null
cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml --arch v3 --features test-build >/dev/null
cargo build-sbf --manifest-path programs/supply-chain/Cargo.toml --arch v3 --features test-build >/dev/null

echo "test: starting local validator (rpc ${RPC_PORT})"
# 清理可能残留的同 ledger validator
if command -v pgrep >/dev/null 2>&1; then
  pgrep -f "solana-test-validator.*${LEDGER_DIR}" | xargs kill 2>/dev/null || true
fi
solana-test-validator --quiet --reset --ledger "$LEDGER_DIR" --rpc-port "${RPC_PORT}" \
  >/tmp/solana-test-validator.log 2>&1 &
VALIDATOR_PID=$!
cleanup() {
  kill "$VALIDATOR_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 180); do
  curl -sf "http://127.0.0.1:${RPC_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "http://127.0.0.1:${RPC_PORT}/health" >/dev/null 2>&1; then
  echo "validator failed to start; log:" >&2
  tail -30 /tmp/solana-test-validator.log >&2
  exit 1
fi

solana config set --url "http://127.0.0.1:${RPC_PORT}" >/dev/null
solana airdrop 10 >/dev/null

echo "test: deploying programs with upgrade authority = current wallet"
solana program deploy target/deploy/trade_finance.so \
  --program-id target/deploy/trade_finance-keypair.json >/dev/null
solana program deploy target/deploy/supply_chain.so \
  --program-id target/deploy/supply_chain-keypair.json >/dev/null

echo "test: running anchor tests (--skip-local-validator --skip-deploy)"
exec anchor test --skip-local-validator --skip-deploy -- --features test-build
