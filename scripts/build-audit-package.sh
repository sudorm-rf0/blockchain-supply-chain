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
cp "${ROOT}/packages/contracts/Cargo.lock" "${PKG_DIR}/contracts/" 2>/dev/null || true
cp "${ROOT}/packages/contracts/package.json" "${PKG_DIR}/contracts/" 2>/dev/null || true
cp "${ROOT}/packages/contracts/tsconfig.json" "${PKG_DIR}/contracts/" 2>/dev/null || true
cp "${ROOT}/packages/contracts/eslint.config.mjs" "${PKG_DIR}/contracts/" 2>/dev/null || true
mkdir -p "${PKG_DIR}/contracts/scripts"
for f in clean-test-ledger.sh test.sh test-anchor.sh; do
  [[ -f "${ROOT}/packages/contracts/scripts/${f}" ]] && cp "${ROOT}/packages/contracts/scripts/${f}" "${PKG_DIR}/contracts/scripts/"
done

# 2) 合约测试（含不变量/边界用例）
cp "${ROOT}/packages/contracts/tests/"*.ts "${PKG_DIR}/contracts/tests/" 2>/dev/null || true

# 3) 文档
for f in CONTRACT-AUDIT.md AUDIT-REPORT.md CERTIK-REPORT.md AUDIT-DELIVERY.md \
         AUDIT-REMEDIATION.md AUDIT-ECONOMIC-MODEL.md AUDIT-KNOWN-RISKS.md \
         MAINNET-MIGRATION.md LAUNCH-CHECKLIST.md CONTRACT-THREAT-MODEL.md \
         CONTRACT-INVARIANTS.md OPERATIONS.md H-04-费率重构方案.md \
         上线准备-DFR-0148通过.md; do
  [[ -f "${ROOT}/docs/${f}" ]] && cp "${ROOT}/docs/${f}" "${PKG_DIR}/docs/"
done

# 4) 治理/部署校验脚本（审计 N-03/N-05 部署侧证据，docs 引用；不含私钥）
mkdir -p "${PKG_DIR}/scripts"
for f in precheck-mainnet-deploy.sh verify-contract-deployment.sh verify-deployment.sh \
         deploy-mainnet.sh init-mainnet.sh reconcile.sh health-check.sh; do
  [[ -f "${ROOT}/scripts/${f}" ]] && cp "${ROOT}/scripts/${f}" "${PKG_DIR}/scripts/"
done

# 5) 历史审计报告 / PoC（可选来源：AUDIT_REPORTS_DIR 或仓库 reports/）
#    I-07 要求随包交付历轮 DFR 报告与 PoC，供交付物级复核。
REPORTS_SRC="${AUDIT_REPORTS_DIR:-${ROOT}/reports}"
if [[ -d "${REPORTS_SRC}" ]]; then
  mkdir -p "${PKG_DIR}/reports"
  cp -R "${REPORTS_SRC}/." "${PKG_DIR}/reports/"
  echo "  (reports 已随包：$(find "${PKG_DIR}/reports" -type f | wc -l | tr -d ' ') 个文件)"
else
  echo "  ⚠️ 未找到 reports 源（AUDIT_REPORTS_DIR 或 repo/reports），跳过历史报告；I-07 要求签署包必须包含 reports/"
fi

# 6) 部署信息（Program ID / 账户，脱敏：不包含私钥）
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

测试结果（审计可核验，基于本包内容）:
  Anchor 集成: 69/69 通过（trade-finance.ts 50 + supply-chain.ts 17 + c1-program-data-regression.ts 2，含资金恒等式/记账增量断言 + 治理 + 审计整改回归 + H-3 捐赠回归 + C-1 伪造 program_data 拒绝回归 + H-1 治理时锁）
  Rust 单元（含 proptest）: 24/24（trade-finance 15 + supply-chain 9，其中 supply-chain 含 1 proptest）

说明:
  - 本包不含任何私钥/keypair，仅供审计代码审查。
  - 主网 Program ID 为部署时新生成（见 docs/MAINNET-MIGRATION.md）。
  - 后端/前端测试不在本合约审计包范围内；相关测试与 CI 结果见仓库 CI 与 AUDIT-REPORT.md。

更新（2026-08-08 第四轮 / 方案 B + N-01 精度 + 复测整改）:
  - LP mint 精度: 0 -> 6（审计 N-01：1 USDC = 1 LP，首笔 1:1 铸造）。
  - NAV/redemption_price 以「每 LP token」计，放大 LP_DECIMALS_FACTOR(1e6)，与前端展示语义一致。
  - H-3: 定价以权威 tracked_vault 为基准，直捐=不可申领盈余，存取不锁死。
  - C-1: program_data 绑定本程序真实 ProgramData PDA（address+owner），新增 anchor 拒绝回归。
  - N-13: withdraw_first_loss 偿付检查改用 tracked_vault（捐赠不再虚增可提取额度）。
  - M-05: deploy 脚本同步 declare_id! 与部署 keypair ID（含 Anchor.toml [programs.mainnet]），
    precheck 增加 Program ID 一致性检查。
  - H-1: 价值转移 setters（改平台钱包/提首损/换 LP mint/费率/风控）两阶段 propose->execute
    治理时锁（等待 pending_admin_delay_secs，生产 >= 86400s）。
  - H-2: 已根除 test-deployer feature 与 DEPLOYER 白名单；UA 校验仅接受 == upgrade authority，
    None（冻结）一律拒绝；测试改用 test-build（仅放宽 initial_delay）。
  - N-new: NAV/redemption_price 全部改用权威记账 tracked_vault 计算（含 fund 放款后口径）。
  - anchor test 实测: 69/69 通过（本地 validator + test-build 构建复验，
    含 H-3 捐赠回归、N-01/N-06 定价一致性、C-1 拒绝回归、H-1 时锁）。
INFO

# 7) 清单
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

# 8) 打包
cd "${OUT_DIR}"
tar -czf "${PKG_TAR}" "$(basename "${PKG_DIR}")"
echo "✅ 审计材料包已生成：${PKG_TAR}"
echo "   （含 $(find "${PKG_DIR}" -type f | wc -l | tr -d ' ') 个文件）"
