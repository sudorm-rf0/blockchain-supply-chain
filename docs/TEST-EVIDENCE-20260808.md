# 测试证据（真实仓库执行，2026-08-08）

> 回应 `supply-chain-project-evaluation-20260808.md` §7-5「独立运行测试套件并附原始输出」。
> 全部在真实仓库 `/Users/fangfang/Documents/区块链供应链`（main）执行，非声明采信。

## 工具链
- Solana CLI 4.1.2（Agave）；Anchor CLI 0.31.1（`cargo +1.79.0 install --tag v0.31.1`）；Rust 1.79.0
- 测试构建：`--features test-build`（仅放宽 initial_delay，无白名单）

## 执行结果

| 套件 | 命令 | 结果 |
|---|---|---|
| Anchor 集成 | `cd packages/contracts && pnpm test` | **71/71 passing**（含新增 D-01 supplier_key seeds/has_one 回归） |
| Rust 单测 trade | `cargo test -p trade-finance` | **15/15** |
| Rust 单测 supply | `cargo test -p supply-chain` | **9/9**（含 1 proptest） |
| 后端 | `cd packages/backend && pnpm test -- --runInBand` | **155/155** |
| 前端 | `cd packages/frontend && pnpm test` | **50/50** + tsc/lint 0 error |
| 本地端到端 | `bash scripts/ci-e2e.sh` | **10/10 API + smoke-e2e 全断言**（含新增 D2 负向 `repaymentDefaultGuard`、F5 `supplyChainRevokeSupplier/RevokeProduct/RejectRevoked`） |
| 本地多签迁移演练 | `bash scripts/multisig-rehearsal/run.sh` | **PASS**（propose_admin → 时锁 → accept_admin） |
| devnet 治理投票 | `RPC=https://api.devnet.solana.com node scripts/multisig-rehearsal/devnet-governance-test.mjs` | **PASS ×2**（3-of-5 提案 → 投票 → 多签执行转账 0.001 SOL） |

## Anchor 用例构成（70）
- trade-finance.ts：**51**（含 H-1 治理时锁 propose/execute、L-10 paused 冻结首损提取、H-3 捐赠回归、H-04/05/06 时锁）
- supply-chain.ts：**18**（含新增 D-01 supplier_key seeds/has_one 回归；D-01 由第三轮审计提出）
- c1-program-data-regression.ts：**2**（C-1 伪造 program_data 拒绝）
- （compute-units.ts 在 ANCHOR_BENCH=1 时单独运行）

## 原始输出片段
```
  70 passing (2m)
paused blocks withdraw_first_loss (L-10)          # L-10 回归（本轮新增）
✔ Paused pool blocks execute_withdraw_first_loss (L-10) (3798ms)
✔ Admin can propose+execute platform wallet after timelock; rejects default (H-1)
✔ H-1 governance timelock: cancel clears pending; empty slot rejects execute
✔ External vault donations cannot manipulate pricing (H-3 regression)
✔ trade-finance: rejects initialize_pool with forged program_data (C-1)
```

## 链上字节码一致性（§7-3/4）
- 本地 `cargo build-sbf --arch v3`（无 test-build）产物 SHA-256 已随 deployment-info 记录
- 主网部署后：`SOLANA_RPC_URL=... TRADE_FINANCE_PROGRAM_ID=... bash scripts/verify-deployment.sh`
  执行 `solana program dump` 与本地 `.so` SHA-256 比对；`verify-audit-artifact.sh` 校验审计包 == 仓库 HEAD

*审计方可在真实仓库复跑上述命令核验；部署字节码一致性须在主网部署后执行。*
