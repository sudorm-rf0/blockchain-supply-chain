#!/usr/bin/env bash
set -euo pipefail

SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"
if [ -d "$SOLANA_BIN" ] || [ -d "$CARGO_BIN" ]; then
  export PATH="$CARGO_BIN:$SOLANA_BIN:$PATH"
fi

# macOS bsdtar writes AppleDouble (._*) entries into genesis.tar.bz2, which
# the validator's ledger unpack check rejects with a "blockstore error".
export COPYFILE_DISABLE=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for cmd in anchor solana solana-test-validator cargo-build-sbf curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required command not found: $cmd (check SOLANA_BIN/CARGO_BIN)" >&2
    exit 1
  }
done

mkdir -p "$HOME/.config/solana"
if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
  solana-keygen new --force --no-bip39-passphrase -o "$HOME/.config/solana/id.json" >/dev/null
fi
WALLET="$HOME/.config/solana/id.json"

# 清理上次测试遗留的验证器账本（移动而非删除，避免误删）。
LEDGER_DIR="$ROOT/.anchor/test-ledger"
if [ -d "$LEDGER_DIR" ]; then
  mkdir -p /tmp/.trash
  mv "$LEDGER_DIR" "/tmp/.trash/test-ledger-$(date +%Y%m%d-%H%M%S)"
fi

# Agave 4.1.2 localnet 只接受 SBFv3（eBPF）程序，anchor build 默认目标会被拒。
echo ">> building programs (cargo build-sbf --arch v3)..."
(
  cd packages/contracts
  cargo build-sbf --arch v3 >/dev/null
)

# 选择一组空闲端口，避开正在运行的 demo 验证器（8899/8001-8018 等）。
read -r RPC_PORT FAUCET_PORT GOSSIP_PORT < <(python3 - <<'PY'
import socket, random

def free_tcp():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p

for _ in range(50):
    rpc = free_tcp()
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", rpc + 1))  # websocket 端口 = rpc + 1
        s.close()
        break
    except OSError:
        s.close()
else:
    raise SystemExit("could not find two consecutive free TCP ports")

faucet = free_tcp()
while faucet in (rpc, rpc + 1):  # 避开 rpc 与 rpc websocket 端口
    faucet = free_tcp()

print(rpc, faucet, random.randint(20000, 40000))
PY
)
echo ">> isolated test validator: rpc=$RPC_PORT faucet=$FAUCET_PORT gossip=$GOSSIP_PORT"
CLUSTER="http://127.0.0.1:$RPC_PORT"
LEDGER="$ROOT/.anchor/test-ledger"
mkdir -p "$ROOT/.anchor"

cleanup() {
  if [[ -n "${VALIDATOR_PID:-}" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  if [[ -d "$LEDGER" ]]; then
    mkdir -p /tmp/.trash
    mv "$LEDGER" "/tmp/.trash/test-ledger-$(date +%Y%m%d-%H%M%S)"
  fi
  # anchor test 的 build 会用默认 SBF 目标覆盖 target/deploy，恢复为可部署的 v3 产物。
  ( cd "$ROOT/packages/contracts" && cargo build-sbf --arch v3 >/dev/null 2>&1 || true )
}
trap cleanup EXIT

solana-test-validator \
  --ledger "$LEDGER" \
  --rpc-port "$RPC_PORT" \
  --faucet-port "$FAUCET_PORT" \
  --gossip-port "$GOSSIP_PORT" \
  --dynamic-port-range "$((GOSSIP_PORT + 1))-$((GOSSIP_PORT + 50))" \
  --reset \
  >/tmp/supply-chain-test-validator.log 2>&1 &
VALIDATOR_PID=$!

for i in $(seq 1 90); do
  if curl -sf "$CLUSTER/health" 2>/dev/null | grep -q ok; then
    break
  fi
  sleep 1
done
if ! curl -sf "$CLUSTER/health" 2>/dev/null | grep -q ok; then
  echo "validator did not become healthy; see /tmp/supply-chain-test-validator.log" >&2
  exit 1
fi

solana --url "$CLUSTER" airdrop 100 "$(solana -k "$WALLET" address)" >/dev/null

echo ">> deploying programs..."
solana program deploy --url "$CLUSTER" --keypair "$WALLET" \
  packages/contracts/target/deploy/supply_chain.so \
  --program-id packages/contracts/target/deploy/supply_chain-keypair.json >/dev/null
solana program deploy --url "$CLUSTER" --keypair "$WALLET" \
  packages/contracts/target/deploy/trade_finance.so \
  --program-id packages/contracts/target/deploy/trade_finance-keypair.json >/dev/null

export PATH="$ROOT/packages/contracts/node_modules/.bin:$PATH"
# 审计 H-01/N-05：initialize_* 要求初始化者 == 程序 upgrade authority（部署钱包）。
# 显式把 anchor provider 钱包指到部署钱包，避免 CI/本地环境差异导致 Unauthorized。
export ANCHOR_WALLET="$WALLET"
(
  cd packages/contracts
  echo ">> running anchor test suite against $CLUSTER (wallet=$(basename "$WALLET")) ..."
  anchor test --skip-local-validator --skip-deploy --provider.cluster "$CLUSTER"
)
