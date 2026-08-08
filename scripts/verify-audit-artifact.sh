#!/usr/bin/env bash
# 审计工件一致性校验（审计 §3 版本锁定门槛）：
#   解包 audit-package-<日期>.tar.gz，与真实仓库 HEAD 源码逐文件比对，
#   确保「审计源码 == 部署候选源码」逐字节一致；并输出 SHA-256 供锁定权威产物。
# 用法：bash scripts/verify-audit-artifact.sh [audit-package.tar.gz]
# 退出码：0 = 全部一致；1 = 存在差异（禁止以此包放行）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${1:-${ROOT}/dist-audit/audit-package-$(date +%Y%m%d).tar.gz}"
TMP="$(mktemp -d /tmp/audit-verify.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

[[ -f "$PKG" ]] || { echo "❌ 找不到审计包：$PKG" >&2; exit 1; }

echo "审计包：$PKG"
echo "SHA-256：$(shasum -a 256 "$PKG" | awk '{print $1}')"
echo "=================================================="

tar -xzf "$PKG" -C "$TMP"
PKG_DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"

# 关键源码/测试文件（审计包 contracts/ 相对布局 ↔ 仓库 packages/contracts/ 布局）
PAIRS=(
  "programs/trade-finance/src/lib.rs"
  "programs/trade-finance/src/state.rs"
  "programs/trade-finance/src/error.rs"
  "programs/trade-finance/src/events.rs"
  "programs/supply-chain/src/lib.rs"
  "programs/trade-finance/Cargo.toml"
  "programs/supply-chain/Cargo.toml"
  "Anchor.toml"
  "tests/trade-finance.ts"
  "tests/supply-chain.ts"
  "tests/c1-program-data-regression.ts"
  "tests/compute-units.ts"
)
FAIL=0
for rel in "${PAIRS[@]}"; do
  if [[ ! -f "${PKG_DIR}/contracts/${rel}" ]]; then
    echo "  ❌ 包内缺失 ${rel}"
    FAIL=1
    continue
  fi
  if diff -q "${ROOT}/packages/contracts/${rel}" "${PKG_DIR}/contracts/${rel}" >/dev/null 2>&1; then
    echo "  ✅ ${rel}"
  else
    echo "  ❌ ${rel} 与仓库 HEAD 不一致"
    FAIL=1
  fi
done

echo "=================================================="
if [[ "${FAIL}" == "0" ]]; then
  echo "✅ 审计包源码与仓库 HEAD 逐文件一致（可作唯一权威部署候选）"
else
  echo "❌ 存在差异：请重新打包后再放行" >&2
  exit 1
fi
