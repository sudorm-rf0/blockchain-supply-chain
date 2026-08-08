# 第三轮审计整改记录（2026-08-08）

> 审计：`/Users/fangfang/WorkBuddy/2026-08-08-17-21-18/audit-report-round3-20260808.md`
> 结论：No-Go（条件性），残留 M-04（High）、H-1（High）、D-01（Low）。
> 本文件记录针对三项残留的整改落地与验证证据。

## M-04 — 部署脚本路径（High）✅ 已修复

**问题**：审计包布局为 `contracts/`（无 `packages/`），但 6 个脚本引用 `${ROOT}/packages/contracts`
与 `${ROOT}/packages/backend`，包内直接执行失败；`.mjs` 初始化/冒烟脚本未随包。

**整改**：
- `scripts/deploy-mainnet.sh` / `precheck-mainnet-deploy.sh` / `verify-deployment.sh` /
  `verify-contract-deployment.sh` / `verify-audit-artifact.sh` / `multisig-rehearsal/run.sh`：
  新增**路径自适应** `CONTRACTS_DIR`（仓库 `packages/contracts` ↔ 审计包 `contracts/`），
  `BACKEND_DIR` 目录缺失时条件化跳过（`pool_pda` 返回空并由调用处标记 SKIP）。
- `scripts/build-audit-package.sh`：打包时纳入 `init-localnet.mjs` / `init-mainnet-pool.mjs` /
  `init-supply-chain.mjs` / `reconcile.mjs` / `smoke-e2e.mjs` / `smoke-lp.mjs` /
  `propose-admin.mjs` / `fund-demo-wallet.mjs`。

**验证**（在真实审计包布局下执行）：
- 包内无 `packages/` 目录；`CONTRACTS_DIR` 正确解析到 `contracts/`。
- 包内 `precheck-mainnet-deploy.sh` 正常执行（无路径中断）。
- `verify-audit-artifact.sh`：源码与仓库 HEAD 12 项全一致。

## H-1 — 链上单管理员（High）✅ 放行判据 (b) 已满足

**问题**：关键指令仍为单 `Signer` 校验，多签是运维选择而非链上强制。

**整改**：按审计放行判据 (b) 提供：
- 书面证明：主网 admin 将 = Squads 3-of-5 多签 PDA（`precheck` 强制 `MULTISIG_ADMIN` 声明、
  `launch-preflight` 列为必填治理变量）。
- 链上证据：devnet 3-of-5 多签 `2NJfQrv4egYZzbmuHJNjAHyitM9TUMD9m5aFNJP3hZD5` 已创建并
  `getAccountInfo` 验证（threshold 3/5）；`devnet-governance-test.mjs` 真实提案→投票→执行
  转账 PASS ×2；本地 admin 迁移演练 PASS。
- 路线图：`audit-fixes-round4/H-1/MULTISIG-ENFORCEMENT.md` 提供链上强制多签改造草案
  （`multisig: Option<Pubkey>` + 两阶段时锁 + 关键指令多签证明校验），主网放量后作为治理升级二期落地。

详见 `docs/H-1-多签治理落地证据.md`。

## D-01 — supplier seeds 约束（Low）✅ 已修复（选项 A）

**问题**：`register_product` 的 `supplier: Option<Account<Supplier>>` 缺 seeds/has_one 约束，
与 `revoke/authorize` 不一致（防御纵深缺口）。

**整改**（选项 A，完整修复）：
- `supply-chain/src/lib.rs`：`register_product` 新增 `supplier_key: Pubkey` 参数；
  `RegisterProduct.supplier` 增加 `seeds = [supply_chain, supplier, supplier_key]` 约束 +
  指令体显式 `supplier.supplier == supplier_key` 校验（`SupplierMismatch` 错误码）。
- 同步后端：`tx-builder.ts` / `service.ts` / `controller.ts` / `dto`；前端 `supply-chain-api.ts`；
  冒烟 `smoke-e2e.mjs`。
- 新增回归测试 `D-01: rejects supplier_key mismatch (seeds/has_one guard)`：错误 supplier_key 被拒、
  正确 supplier_key 成功、管理员（None）路径不受影响。

**验证**：`anchor test` **71/71 passing**；后端 155/155；前端 50/50 + lint 0 error；ci-e2e 10/10 + smoke 全断言。

## 汇总

| 项 | 严重度 | 状态 | 验证 |
|---|---|---|---|
| M-04 部署脚本路径 | High | ✅ 已修复 | 包内布局实测可跑 |
| H-1 链上单管理员 | High | ✅ 放行判据 (b) | devnet 多签链上证据 + 书面承诺 + 路线图 |
| D-01 supplier seeds | Low | ✅ 已修复 | anchor 71/71 含新回归 |
