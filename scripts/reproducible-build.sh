#!/usr/bin/env bash
# 可复现构建：固定工具链下构建两个程序，输出 .so 哈希；可选两次构建比对证明确定性。
#
# 用法：
#   bash scripts/reproducible-build.sh                 # 构建一次，输出 .so + SHA-256 + 环境快照
#   bash scripts/reproducible-build.sh --verify-twice  # 构建两次并比对哈希（确定性证明）
#   bash scripts/reproducible-build.sh --json          # 输出 JSON 报告
#
# 可复现性依据：
#   - Cargo.lock 已锁定（packages/contracts/Cargo.lock）
#   - Anchor/Solana/Rust 版本固定（0.31.1 / 4.1.2 SBFv3 / 见下方）
#   - 同环境两次构建 .so 哈希一致 => 源码→字节码确定性
#   - 链上字节码对比见 scripts/verify-reproducible.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
export PATH="${SOLANA_BIN}:$HOME/.cargo/bin:$PATH"

VERIFY_TWICE=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --verify-twice) VERIFY_TWICE=1 ;;
    --json) JSON=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

report() {
  if [[ "${JSON}" == "1" ]]; then echo "$@"; else echo "$*"; fi
}

# ---------- 工具链快照 ----------
SNAPSHOT="$(cat <<SNAP
rustc=$(rustc --version 2>/dev/null || echo n/a)
anchor=$(anchor --version 2>/dev/null || echo n/a)
solana=$(solana --version 2>/dev/null | head -1 || echo n/a)
cargo_lock_sha256=$(shasum -a 256 "${ROOT}/packages/contracts/Cargo.lock" 2>/dev/null | cut -d' ' -f1 || echo n/a)
SNAP
)"

# ---------- 构建一次 ----------
build_once() {
  (cd "${ROOT}/packages/contracts" && anchor build >/tmp/rebuild-$$.log 2>&1) || {
    tail -30 /tmp/rebuild-$$.log >&2; rm -f /tmp/rebuild-$$.log; exit 1
  }
  rm -f /tmp/rebuild-$$.log
}

build_once
TRADE_SO="${ROOT}/packages/contracts/target/deploy/trade_finance.so"
SUPPLY_SO="${ROOT}/packages/contracts/target/deploy/supply_chain.so"
TRADE_HASH="$(shasum -a 256 "${TRADE_SO}" | cut -d' ' -f1)"
SUPPLY_HASH="$(shasum -a 256 "${SUPPLY_SO}" | cut -d' ' -f1)"

# ---------- 两次构建比对（确定性证明） ----------
DET="n/a"
if [[ "${VERIFY_TWICE}" == "1" ]]; then
  build_once
  T2="$(shasum -a 256 "${TRADE_SO}" | cut -d' ' -f1)"
  S2="$(shasum -a 256 "${SUPPLY_SO}" | cut -d' ' -f1)"
  if [[ "${T2}" == "${TRADE_HASH}" && "${S2}" == "${SUPPLY_HASH}" ]]; then
    DET="yes (two builds identical)"
  else
    DET="NO (hash mismatch; toolchain not deterministic)"
  fi
fi

if [[ "${JSON}" == "1" ]]; then
  python3 - <<PY
import json, sys
print(json.dumps({
  "trade_finance": {"so": "${TRADE_SO}", "sha256": "${TRADE_HASH}"},
  "supply_chain": {"so": "${SUPPLY_SO}", "sha256": "${SUPPLY_HASH}"},
  "deterministic": "${DET}",
  "toolchain": """${SNAPSHOT}""",
}, indent=2))
PY
else
  report "==> 可复现构建结果"
  report "  trade_finance: ${TRADE_HASH}"
  report "  supply_chain:  ${SUPPLY_HASH}"
  report "  deterministic: ${DET}"
  report "  工具链快照:"
  echo "${SNAPSHOT}" | sed 's/^/    /'
fi
