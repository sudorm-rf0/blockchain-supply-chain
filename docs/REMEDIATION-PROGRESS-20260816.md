# DFR-2026-0150 统一整改方案 · 推进记录（2026-08-16）

> 对应《统一整改方案报告》的阶段 0/1；本次完成项与证据如下。

## 阶段 0 — 上线前置硬性门（本仓库可闭环部分）

| 项 | 状态 | 证据 / 说明 |
|----|------|------------|
| G-1 / M-05 主网 Program ID 卡禁 | ✅ 卡禁机制就绪 | `scripts/precheck-mainnet-deploy.sh` 检查 `Anchor.toml [programs.mainnet]` 是否仍为 devnet 占位（`9c8eND94…` / `Dcxixk89…`），命中即 `add_check FAIL`；无主网环境变量时整体 **exit 1（硬失败）**。实测：无配置运行输出 `mainnet precheck FAILED` 且 exit=1。 |
| G-2 MULTISIG_ADMIN 硬失败门 | ✅ 机制就绪 | precheck 已把 `MULTISIG_ADMIN` 设为硬失败（未配置多签禁止上线）；链上多签闸门由合约 `PoolState/Registry.multisig` 强制（见 deployment-info.txt H-1 说明）。真实 Squads 3/5 演练为部署侧工作，需用户执行。 |
| G-5 / I-07 交付物计数 | ✅ 本次修正 | `dist-audit/audit-package-20260809/deployment-info.txt` 中后端 jest 计数 `156/156`（2 处）与包内权威 `TEST-EVIDENCE-20260808.md`（后端 155/155）不一致，已统一修正为 **155/155**（第 15/45/68 行自洽）。包结构完整：`contracts/ scripts/ reports/（含 reports/poc/） docs/ audit-fixes*`。⚠️ 重新打包后需按 `scripts/verify-audit-artifact.sh` 更新包 SHA。 |
| G-1~G-4 主网执行 | ⏳ 待用户/部署侧 | 主网 keypair 生成、Squads 多签配置、UA 冻结/时锁、字节码比对均在主网部署时执行（见 `docs/MAINNET-MIGRATION.md`、`GO-LIVE-MULTISIG-RUNBOOK.md`）。 |

## 阶段 1 — 前端链上可信 UI（G-6，本次完成并已部署）

| P0 项 | 交付 | 验证 |
|-------|------|------|
| P0-1 钱包连接 | header 常驻「连接钱包」按钮（Phantom/Backpack/Solflare/Coinbase）+ 网络徽章（Devnet/Mainnet 标注） | 线上 dashboard 实测：按钮与「网络: Devnet」徽章渲染，无 console 错误 |
| P0-2 链上溯源时间线 | 新增 `/trace/[assetId]`：文件/订单/产品的 上传→分析→存证 事件时间线，每条带交易签名 + Solscan 跳转 | 线上 `/trace/<fileId>` 实测：标题「鏈上溯源」+ 事件列表渲染 |
| P0-3 公开验证门户 | 增强 `/verify`：支持 哈希/文件 ID/交易签名 输入核验，展示存证信息，新增溯源与 Solscan 链接；兼容 `?h=hash` 二维码深链 | 线上 `/verify` 实测：输入文件 ID → 核验通过卡片 + 文件名展示 |
| P0-4 链上事件浏览器 | dashboard 新增「最近链上活动」流（存证/订单/产品，可跳转溯源与区块浏览器）；用户/管理员文件列表新增溯源 + Solscan 链接 | 线上 dashboard 实测：活动卡渲染（当前无已存证数据时显示空态） |

配套：后端 `/api/public/verify|trace/:id|activity`（含单元测试 9 个，后端全量 208 测试通过）；onchain 三语文案；登录页新增公开验证入口。

部署：commit `a3de174`（GitHub main / VPS 同步），frontend 镜像重建上线，全部页面 200。

## 阶段 2 / 3 — 待推进（下次）

- P1：通知/告警中心、报表导出（CSV/PDF）、角色化工作台、移动端/PWA
- P2：权限与多签状态可视化（管理后台展示 UA/多签/program_data）、审计链上锚定、2FA 强化、设置入口补全、集群切换标注
- G-1~G-5 主网侧执行（需用户提供主网密钥/多签/授权）
