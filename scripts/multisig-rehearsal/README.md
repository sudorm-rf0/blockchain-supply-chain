# 多签迁移演练脚本

| 脚本 | 用途 | 依赖 |
|---|---|---|
| `squads-create.mjs` | 创建 Squads 3-of-5 多签（devnet/主网/本地） | `@sqds/multisig` `@solana/web3.js` |
| `rehearsal-admin-migration.mjs` | 合约 propose_admin → 时锁 → accept_admin 迁移演练 | `@solana/web3.js` `@solana/spl-token` |
| `run.sh` | 编排：本地 validator + 部署 test-build 合约 + 跑迁移演练 | Solana/Anchor 工具链 |

## 本地演练（已验证通过）
```bash
bash scripts/multisig-rehearsal/run.sh
# 期望输出：🎉 演练通过：admin 已迁移到（模拟）多签 / RESULT=PASS
```

## 真实多签创建（需 SOL 的 devnet/主网）
```bash
# @sqds/multisig 已作为项目 devDependency（2.1.4）；payer 需有 SOL 且不能是 Program ID 账户
RPC=https://api.devnet.solana.com PAYER_KP=~/.config/solana/id.json \
  node scripts/multisig-rehearsal/squads-create.mjs
# 自定义成员/阈值：
#   MEMBERS="<a>,<b>,<c>,<d>,<e>" THRESHOLD=3 RPC=<rpc> PAYER_KP=<kp> \
#     node scripts/multisig-rehearsal/squads-create.mjs
```
> devnet 免费档对 requestAirdrop 有严格限流（429），且偶尔 faucet 全局干涸；如空投失败，请为 payer 转账少量 SOL 或用已 funded 钱包。
> Squads V4 新版程序（`SQDS4ep65…`）要求 `treasury == ProgramConfig.treasury`，脚本已自动读取，无需手工指定。

## 演练记录（2026-08-08，devnet）
- 3-of-5 多签已创建并链上验证：`MULTISIG_PDA=2NJfQrv4egYZzbmuHJNjAHyitM9TUMD9m5aFNJP3hZD5`（程序 `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`，timeLock=0）
- 成员：DKjZeYsB… / F4WD7tD8… / SidAeEGs… / 2y5tHWpV… / Cw8hnS6t…
- 创建钱包（createKey/payer）：`3xrRyw1xnGjaEYmCdFTARt8xVeKcZPUmarJRTwyJ4k8t`（devnet，演练用）
- 主网多签：上线日由持钥冷钱包在 app.squads.so 或同一脚本（主网 RPC + 有钱主网钱包）创建，PDA 会因 createKey 不同而不同

## 上线执行
见 `docs/GO-LIVE-MULTISIG-RUNBOOK.md`（完整操作单）。
