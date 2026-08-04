#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/active_release/bin:$PATH"
export COPYFILE_DISABLE=1
# crates.io sparse index is faster and less likely to hang on CI runners.
export CARGO_REGISTRIES_CRATES_IO_PROTOCOL="${CARGO_REGISTRIES_CRATES_IO_PROTOCOL:-sparse}"
export CARGO_NET_RETRY="${CARGO_NET_RETRY:-3}"
export CARGO_HTTP_TIMEOUT="${CARGO_HTTP_TIMEOUT:-60}"
LEDGER_DIR="${LEDGER_DIR:-/tmp/solana-ci-ledger}"
CI_RPC_PORT="${CI_RPC_PORT:-8899}"
CI_BACKEND_PORT="${CI_BACKEND_PORT:-3001}"
CI_INDEXER_PORT="${CI_INDEXER_PORT:-3003}"
CI_TRADE_PORT="${CI_TRADE_PORT:-3004}"
CI_POOL_PORT="${CI_POOL_PORT:-3005}"
CI_SOLANA_HOME="${CI_SOLANA_HOME:-$HOME/.config/solana}"
CI_RPC_URL="http://127.0.0.1:${CI_RPC_PORT}"
cd "$ROOT"

mkdir -p "${CI_SOLANA_HOME}"
solana-keygen new --force --no-bip39-passphrase -o "${CI_SOLANA_HOME}/id.json" >/dev/null
solana config set --url "${CI_RPC_URL}" >/dev/null
export HOME_CONFIG_DIR="${CI_SOLANA_HOME}"

solana-test-validator --quiet --ledger "$LEDGER_DIR" --reset --rpc-port "${CI_RPC_PORT}" \
  >/tmp/solana-test-validator.log 2>&1 &
VALIDATOR_PID=$!
cleanup() {
  kill "$VALIDATOR_PID" 2>/dev/null || true
  for pid in ${BACKEND_PIDS:-}; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -sf "${CI_RPC_URL}" >/dev/null 2>&1 && break
  sleep 1
done
solana airdrop 100 >/dev/null

cd "$ROOT/packages/contracts"
echo "PHASE anchor-build" >&2
cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml --arch v3 >/dev/null || {
  echo "sbf build failed; retrying once with offline cargo cache" >&2
  CARGO_NET_OFFLINE=true cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml --arch v3 >/dev/null
}
echo "PHASE anchor-deploy" >&2
solana program deploy "$ROOT/packages/contracts/target/deploy/trade_finance.so" \
  --program-id "$ROOT/packages/contracts/target/deploy/trade_finance-keypair.json" \
  --url "${CI_RPC_URL}" >/dev/null

cd "$ROOT"
echo "PHASE init-localnet" >&2
ENV_OUT="$(SOLANA_RPC_URL="${CI_RPC_URL}" node scripts/init-localnet.mjs)"
USDC_MINT="$(printf '%s\n' "$ENV_OUT" | sed -n 's/^USDC_MINT=//p')"
LP_MINT="$(printf '%s\n' "$ENV_OUT" | sed -n 's/^LP_MINT=//p')"

cd "$ROOT/packages/backend"
pnpm build >/dev/null
pnpm build:trade >/dev/null
pnpm build:pool >/dev/null
pnpm build:indexer >/dev/null
pnpm exec prisma migrate deploy >/dev/null
pnpm exec prisma db seed >/dev/null

THROTTLE_LIMIT=100000 PORT="${CI_BACKEND_PORT}" pnpm start >/tmp/backend.log 2>&1 &
BACKEND_PIDS="${BACKEND_PIDS:-} $!"
THROTTLE_LIMIT=100000 TRADE_SERVICE_PORT="${CI_TRADE_PORT}" SOLANA_RPC_URL="${CI_RPC_URL}" \
  USDC_MINT="$USDC_MINT" LP_MINT="$LP_MINT" pnpm start:trade >/tmp/trade.log 2>&1 &
BACKEND_PIDS="${BACKEND_PIDS:-} $!"
REDIS_URL="${REDIS_URL:-redis://localhost:6380}" THROTTLE_LIMIT=100000 POOL_SERVICE_PORT="${CI_POOL_PORT}" \
  SOLANA_RPC_URL="${CI_RPC_URL}" USDC_MINT="$USDC_MINT" LP_MINT="$LP_MINT" \
  pnpm start:pool >/tmp/pool.log 2>&1 &
BACKEND_PIDS="${BACKEND_PIDS:-} $!"
REDIS_URL="${REDIS_URL:-redis://localhost:6380}" INDEXER_PORT="${CI_INDEXER_PORT}" \
  SOLANA_RPC_URL="${CI_RPC_URL}" pnpm start:indexer >/tmp/indexer.log 2>&1 &
BACKEND_PIDS="${BACKEND_PIDS:-} $!"

for _ in $(seq 1 60); do
  curl -sf "http://localhost:${CI_BACKEND_PORT}/health" >/dev/null &&
    curl -sf "http://localhost:${CI_TRADE_PORT}/health" >/dev/null &&
    curl -sf "http://localhost:${CI_POOL_PORT}/health" >/dev/null &&
    break
  sleep 1
done

cd "$ROOT"
echo "PHASE smoke" >&2
SOLANA_RPC_URL="${CI_RPC_URL}" BACKEND_URL="http://localhost:${CI_BACKEND_PORT}" \
  TRADE_URL="http://localhost:${CI_TRADE_PORT}" POOL_URL="http://localhost:${CI_POOL_PORT}" \
  SOLANA_KEYPAIR_PATH="${CI_SOLANA_HOME}/id.json" USDC_MINT="$USDC_MINT" \
  node scripts/smoke-e2e.mjs
echo "PHASE api-smoke" >&2
BACKEND_URL="http://localhost:${CI_BACKEND_PORT}" \
  TRADE_URL="http://localhost:${CI_TRADE_PORT}" \
  POOL_URL="http://localhost:${CI_POOL_PORT}" \
  INDEXER_URL="http://localhost:${CI_INDEXER_PORT}" \
  bash "$ROOT/scripts/smoke-e2e.sh"
echo "ci e2e passed"
