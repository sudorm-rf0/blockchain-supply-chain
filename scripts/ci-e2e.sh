#!/usr/bin/env bash
# 前置依赖：workflow 'Start isolated Postgres and Redis' step 会用 Docker healthcheck 启动隔离的 Postgres(15432)/Redis(16379) 容器并等待 healthy。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/active_release/bin:$PATH"
export COPYFILE_DISABLE=1
# crates.io sparse index is faster and less likely to hang on CI runners.
export CARGO_REGISTRIES_CRATES_IO_PROTOCOL="${CARGO_REGISTRIES_CRATES_IO_PROTOCOL:-sparse}"
export CARGO_NET_RETRY="${CARGO_NET_RETRY:-3}"
export CARGO_HTTP_TIMEOUT="${CARGO_HTTP_TIMEOUT:-60}"
export ALLOW_UNSCANNED_UPLOADS="${ALLOW_UNSCANNED_UPLOADS:-true}"
LEDGER_DIR="${LEDGER_DIR:-/tmp/solana-ci-ledger}"
CI_RPC_PORT="${CI_RPC_PORT:-8901}"
CI_FAUCET_PORT="${CI_FAUCET_PORT:-9901}"
CI_BACKEND_PORT="${CI_BACKEND_PORT:-3001}"
CI_INDEXER_PORT="${CI_INDEXER_PORT:-3003}"
CI_TRADE_PORT="${CI_TRADE_PORT:-3004}"
CI_POOL_PORT="${CI_POOL_PORT:-3005}"
CI_SOLANA_HOME="${CI_SOLANA_HOME:-$HOME/.config/solana}"

pick_free_port() {
  python3 - "$1" <<'PY'
import socket, sys
start = int(sys.argv[1]) if len(sys.argv) > 1 else 8031
for port in range(start, start + 256):
    t = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        t.bind(("127.0.0.1", port))
    except OSError:
        t.close()
        continue
    t.close()
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        u.bind(("0.0.0.0", port))
    except OSError:
        u.close()
        continue
    u.close()
    print(port)
    sys.exit(0)
sys.exit(1)
PY
}
CI_GOSSIP_PORT="${CI_GOSSIP_PORT:-$(pick_free_port 8031)}"
# 端口与密钥目录均可通过 CI_* 环境变量隔离，避免与本地服务冲突
CI_RPC_URL="http://127.0.0.1:${CI_RPC_PORT}"
echo "CI validator ports: rpc=${CI_RPC_PORT} faucet=${CI_FAUCET_PORT} gossip=${CI_GOSSIP_PORT}" >&2
cd "$ROOT"

mkdir -p "${CI_SOLANA_HOME}"
solana-keygen new --force --no-bip39-passphrase -o "${CI_SOLANA_HOME}/id.json" >/dev/null
solana config set --url "${CI_RPC_URL}" >/dev/null
export HOME_CONFIG_DIR="${CI_SOLANA_HOME}"
export SOLANA_KEYPAIR_PATH="${CI_SOLANA_HOME}/id.json"

# 清理可能残留的同 ledger CI validator，避免 ledger 锁冲突。
if command -v pgrep >/dev/null 2>&1; then
  pgrep -f "solana-test-validator.*${LEDGER_DIR}" | xargs kill 2>/dev/null || true
fi

if command -v lsof >/dev/null 2>&1; then
  for port in "${CI_RPC_PORT}" "${CI_FAUCET_PORT}" "${CI_GOSSIP_PORT}"; do
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
  done
fi
solana-test-validator --quiet --ledger "$LEDGER_DIR" --reset --rpc-port "${CI_RPC_PORT}" \
  --faucet-port "${CI_FAUCET_PORT}" --gossip-port "${CI_GOSSIP_PORT}" \
  >/tmp/solana-test-validator.log 2>&1 &
VALIDATOR_PID=$!
cleanup() {
  kill "$VALIDATOR_PID" 2>/dev/null || true
  for pid in ${BACKEND_PIDS:-}; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

for _ in $(seq 1 180); do
  curl -sf "${CI_RPC_URL}/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "${CI_RPC_URL}/health" >/dev/null 2>&1; then
  echo "validator failed to start; log:" >&2
  tail -30 /tmp/solana-test-validator.log >&2
  echo "validator ledger log:" >&2
  tail -50 "$LEDGER_DIR/validator.log" >&2 2>/dev/null || true
  exit 1
fi
solana airdrop 100 --url "${CI_RPC_URL}" --keypair "${CI_SOLANA_HOME}/id.json" >/dev/null

cd "$ROOT/packages/contracts"
echo "PHASE anchor-build" >&2
cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml --arch v3 --features test-deployer >/dev/null || {
  echo "sbf build failed; retrying once with offline cargo cache" >&2
  CARGO_NET_OFFLINE=true cargo build-sbf --manifest-path programs/trade-finance/Cargo.toml --arch v3 --features test-deployer >/dev/null
}
echo "PHASE anchor-deploy" >&2
solana program deploy "$ROOT/packages/contracts/target/deploy/trade_finance.so" \
  --program-id "$ROOT/packages/contracts/target/deploy/trade_finance-keypair.json" \
  --url "${CI_RPC_URL}" --keypair "${CI_SOLANA_HOME}/id.json" >/dev/null

echo "PHASE anchor-build-supply-chain" >&2
cargo build-sbf --manifest-path programs/supply-chain/Cargo.toml --arch v3 --features test-deployer >/dev/null
solana program deploy "$ROOT/packages/contracts/target/deploy/supply_chain.so" \
  --program-id "$ROOT/packages/contracts/target/deploy/supply_chain-keypair.json" \
  --url "${CI_RPC_URL}" --keypair "${CI_SOLANA_HOME}/id.json" >/dev/null

cd "$ROOT"
echo "PHASE init-localnet" >&2
ENV_OUT="$(SOLANA_RPC_URL="${CI_RPC_URL}" node scripts/init-localnet.mjs)"
USDC_MINT="$(printf '%s\n' "$ENV_OUT" | sed -n 's/^USDC_MINT=//p')"
LP_MINT="$(printf '%s\n' "$ENV_OUT" | sed -n 's/^LP_MINT=//p')"

cd "$ROOT/packages/backend"
pnpm --filter @supply-chain/common build >/dev/null
pnpm build >/dev/null
pnpm build:trade >/dev/null
pnpm build:pool >/dev/null
pnpm build:indexer >/dev/null
pnpm exec prisma migrate deploy >/dev/null
pnpm exec prisma db seed >/dev/null

THROTTLE_LIMIT=100000 SOLANA_RPC_URL="${CI_RPC_URL}" PORT="${CI_BACKEND_PORT}" pnpm start >/tmp/backend.log 2>&1 &
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
