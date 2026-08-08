# 审计补丁参考（audit-fixes-20260809）

- `h1-multisig-positive.test.ts`：审计方提供的正路径测试脚手架（基于 @sqds/multisig 旧版
  `lib/instructions` API）。项目 @sqds/multisig 2.1.4 使用 rpc API，已由
  `scripts/multisig-rehearsal/h1-positive-path-local.mjs` 完整实现并本地验证 PASS
  （真实 Squads v4 --clone + VaultTransaction 包裹合约 admin 指令 + 3/5 批准 + 执行成功）。
- `H-1-PATCHES.md`：审计方 SEARCH→REPLACE hunk。对应改动均已落地：
  - precheck MULTISIG_ADMIN 硬失败 + on-chain multisig enforced（scripts/precheck-mainnet-deploy.sh）
  - vault 索引：项目已用链上 multisig_vault_index 字段（比补丁的 SQUADS_VAULT_INDEX 常量更彻底）
  - deployment-info 诚实化（scripts/build-audit-package.sh）
