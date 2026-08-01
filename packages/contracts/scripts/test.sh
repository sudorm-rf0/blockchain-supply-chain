#!/usr/bin/env bash
set -euo pipefail

SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"
if [ -d "$SOLANA_BIN" ] || [ -d "$CARGO_BIN" ]; then
  export PATH="$CARGO_BIN:$SOLANA_BIN:$PATH"
fi

# macOS bsdtar writes AppleDouble (._*) entries into genesis.tar.bz2, which
# solana 1.17.x rejects during its unpack check with a "blockstore error".
export COPYFILE_DISABLE=1

cd "$(dirname "$0")/.."
bash scripts/clean-test-ledger.sh
anchor test
