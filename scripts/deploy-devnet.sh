#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
export PATH="${SOLANA_BIN}:$HOME/.cargo/bin:$PATH"

# 可选：infra/config/rpc.devnet.env 提供正式 devnet RPC（Helius 等）。
if [[ -f "${ROOT}/infra/config/rpc.devnet.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/infra/config/rpc.devnet.env"
  set +a
fi

if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
  echo "devnet wallet not found at ~/.config/solana/id.json" >&2
  echo "run: solana-keygen new -o ~/.config/solana/id.json" >&2
  exit 1
fi

command -v anchor >/dev/null || { echo "anchor CLI not found" >&2; exit 1; }
command -v solana >/dev/null || { echo "solana CLI not found" >&2; exit 1; }

SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
solana config set --url "${SOLANA_RPC_URL}" >/dev/null
ADDRESS="$(solana address)"
BALANCE="$(solana balance | awk '{print $1}')"
echo "devnet wallet: ${ADDRESS} (balance ${BALANCE} SOL)"
if [[ "${BALANCE}" == "0" ]]; then
  echo "wallet has no devnet SOL; run: solana airdrop 2 ${ADDRESS}" >&2
fi

cd "${ROOT}/packages/contracts"
anchor build
# Agave devnet expects the same SBFv3 target used by the CI localnet validator.
cargo build-sbf --arch v3 >/dev/null
solana program deploy target/deploy/trade_finance.so \
  --program-id target/deploy/trade_finance-keypair.json
solana program deploy target/deploy/supply_chain.so \
  --program-id target/deploy/supply_chain-keypair.json

echo "devnet deployment finished."
echo "trade_finance program id: 9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3"
echo "supply_chain program id: Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk"
