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
cd /tmp/squads-rehearsal && npm i @sqds/multisig @solana/web3.js   # 或项目内安装
RPC=https://api.devnet.solana.com node scripts/multisig-rehearsal/squads-create.mjs
```
> devnet 免费档对 requestAirdrop 有严格限流（429）；如空投失败，请为 payer 转账少量 SOL 或用已 funded 钱包。

## 上线执行
见 `docs/GO-LIVE-MULTISIG-RUNBOOK.md`（完整操作单）。
