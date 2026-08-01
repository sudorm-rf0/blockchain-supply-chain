#!/usr/bin/env bash
set -euo pipefail

LEDGER_DIR=".anchor/test-ledger"
TRASH_ROOT="${TMPDIR:-/tmp}/.trash"

if [ -d "$LEDGER_DIR" ]; then
  mkdir -p "$TRASH_ROOT"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  mv "$LEDGER_DIR" "$TRASH_ROOT/test-ledger-$STAMP"
  echo "moved stale $LEDGER_DIR -> $TRASH_ROOT/test-ledger-$STAMP"
fi
