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
cd "$ROOT"

mkdir -p "$HOME/.config/solana"
solana-keygen new --force --no-bip39-passphrase -o "$HOME/.config/solana/id.json" >/dev/null
solana config set --url http://127.0.0.1:8899 >/dev/null

solana-test-validator --quiet --ledger "$LEDGER_DIR" --reset >/tmp/solana-test-validator.log 2>&1 &
VALIDATOR_PID=$!
cleanup() {
  kill "$VALIDATOR_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  solana cluster-version >/dev/null 2>&1 && break
  sleep 1
done
solana airdrop 100 >/dev/null

cd "$ROOT/packages/contracts"
cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml >/dev/null
rustup default 1.86.0
anchor build >/dev/null || {
  echo "anchor build failed; retrying once with offline cargo cache" >&2
  CARGO_NET_OFFLINE=true anchor build >/dev/null
}
anchor deploy --provider.cluster localnet --program-name trade_finance >/dev/null

cd "$ROOT"
ENV_OUT="$(node scripts/init-localnet.mjs)"
USDC_MINT="$(printf '%s\n' "$ENV_OUT" | sed -n 's/^USDC_MINT=//p')"
LP_MINT="$(printf '%s\n' "$ENV_OUT" | sed -n 's/^LP_MINT=//p')"

cd "$ROOT/packages/backend"
pnpm build >/dev/null
pnpm build:trade >/dev/null
pnpm build:pool >/dev/null
pnpm build:indexer >/dev/null
pnpm exec prisma migrate deploy >/dev/null
pnpm exec prisma db seed >/dev/null

THROTTLE_LIMIT=100000 pnpm start >/tmp/backend.log 2>&1 &
THROTTLE_LIMIT=100000 USDC_MINT="$USDC_MINT" LP_MINT="$LP_MINT" pnpm start:trade >/tmp/trade.log 2>&1 &
REDIS_URL="${REDIS_URL:-redis://localhost:6379}" THROTTLE_LIMIT=100000 \
  USDC_MINT="$USDC_MINT" LP_MINT="$LP_MINT" pnpm start:pool >/tmp/pool.log 2>&1 &
REDIS_URL="${REDIS_URL:-redis://localhost:6379}" pnpm start:indexer >/tmp/indexer.log 2>&1 &

for _ in $(seq 1 60); do
  curl -sf http://localhost:3001/health >/dev/null &&
    curl -sf http://localhost:3004/health >/dev/null &&
    curl -sf http://localhost:3005/health >/dev/null &&
    break
  sleep 1
done

cd "$ROOT"
USDC_MINT="$USDC_MINT" node scripts/smoke-e2e.mjs
echo "ci e2e passed"
