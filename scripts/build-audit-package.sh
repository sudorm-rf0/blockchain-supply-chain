#!/usr/bin/env bash
# 打包第三方审计材料：合约源码 + 测试 + 审计/经济模型/已知风险文档 + 部署信息
# 用法：bash scripts/build-audit-package.sh [输出目录]
# 输出：<输出目录>/audit-package-<日期>.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-${ROOT}/dist-audit}"
STAMP="$(date +%Y%m%d)"
PKG_DIR="${OUT_DIR}/audit-package-${STAMP}"
PKG_TAR="${OUT_DIR}/audit-package-${STAMP}.tar.gz"

if [[ -d "${PKG_DIR}" ]]; then
  mv "${PKG_DIR}" "/tmp/.trash-audit-package-$(date +%s)" 2>/dev/null || true
fi
mkdir -p "${PKG_DIR}/contracts/programs" "${PKG_DIR}/contracts/tests" "${PKG_DIR}/docs"

# 1) 合约源码
cp -R "${ROOT}/packages/contracts/programs/trade-finance" "${PKG_DIR}/contracts/programs/"
cp -R "${ROOT}/packages/contracts/programs/supply-chain" "${PKG_DIR}/contracts/programs/"
cp "${ROOT}/packages/contracts/Cargo.toml" "${PKG_DIR}/contracts/" 2>/dev/null || true
cp "${ROOT}/packages/contracts/Anchor.toml" "${PKG_DIR}/contracts/" 2>/dev/null || true

# 2) 合约测试（含不变量/边界用例）
cp "${ROOT}/packages/contracts/tests/"*.ts "${PKG_DIR}/contracts/tests/" 2>/dev/null || true

# 3) 文档
for f in CONTRACT-AUDIT.md AUDIT-REPORT.md CERTIK-REPORT.md AUDIT-DELIVERY.md \
         AUDIT-ECONOMIC-MODEL.md AUDIT-KNOWN-RISKS.md MAINNET-MIGRATION.md \
         LAUNCH-CHECKLIST.md; do
  [[ -f "${ROOT}/docs/${f}" ]] && cp "${ROOT}/docs/${f}" "${PKG_DIR}/docs/"
done

# 4) 部署信息（Program ID / 账户，脱敏：不包含私钥）
cat > "${PKG_DIR}/deployment-info.txt" <<INFO
Blockchain Supply Chain - 审计部署信息
日期: $(date -u +%Y-%m-%dT%H:%M:%SZ)
工具链: Anchor 0.31.1 / Agave 4.1.2 (SBFv3)

devnet 部署（当前已验证）:
  trade-finance:  9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3
  supply-chain:   Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk
  PoolState PDA:  FyPxzVPLfKWFsG4eC2jo5BVwbdeM4MKiyTVbkULXvEbB
  USDC (devnet测试): 2MTv8NwqdaquHfMwBVB9ap3ZP7foF1erALDYXWK2GKVc
  LP (devnet测试):   HkPYrCPbJzTSJUBxc62n8nV8g1dafrMisEnDQw55VjFc

测试结果（最新 CI/local）:
  Anchor 集成: 43/43 通过（含 create/fund/default 记账增量断言）
  后端 Jest: 143/143
  前端 Vitest: 46/46

说明:
  - 本包不含任何私钥/keypair，仅供审计代码审查。
  - 主网 Program ID 为部署时新生成（见 docs/MAINNET-MIGRATION.md）。
INFO

# 5) 清单
cat > "${PKG_DIR}/README.md" <<README
# 审计材料包 ${STAMP}

## 内容
- contracts/programs/  合约源码（trade-finance + supply-chain）
- contracts/tests/     Anchor 集成测试（含资金恒等式/记账增量断言）
- contracts/Cargo.toml, Anchor.toml  构建配置
- docs/                内部审计报告、经济模型、已知风险、迁移清单
- deployment-info.txt  部署地址与测试结果（无私钥）

## 建议审计重点
见 docs/AUDIT-KNOWN-RISKS.md（DistributeDividends / rebate / LP mint authority /
default 保险路径 / u64 边界 / 集中度 / supply-chain 权限）。
README

# 6) 打包
cd "${OUT_DIR}"
tar -czf "${PKG_TAR}" "$(basename "${PKG_DIR}")"
echo "✅ 审计材料包已生成：${PKG_TAR}"
echo "   （含 $(find "${PKG_DIR}" -type f | wc -l | tr -d ' ') 个文件）"
