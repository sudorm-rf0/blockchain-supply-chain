# 安全修复 2026-08-29（第二轮应用层）

> 对应问题清单：6 项应用层安全缺陷，全部修复并验证。

## 修复明细

| # | 问题 | 修复 | 验证 |
|---|---|---|---|
| 1 | Helius devnet RPC key（829d9591-…aa5b）出现在本机/生产配置 | 从所有交付物移除真实 key（`infra/config/rpc.devnet.env`、`deploy/vps/.env.app.mainnet` 改为占位符+轮换说明）；前端本就 env 注入无硬编码 | 全仓 grep 确认无完整 key；git history 无完整 key |
| 2 | `/api/pool/overview` 未授权暴露资金池财务全貌 | 加 `@UseGuards(AuthGuard)`（需登录） | 构建+测试通过；前端 dashboard 登录后正常（cookie 自动携带） |
| 3 | `/api/indexer/status` 泄露 Bull 队列内部信息 | 加 `@UseGuards(AuthGuard)`（需登录） | 构建+测试通过 |
| 4 | `/api/email-verification/send` 邮件轰炸/费用滥用 | 新增全局限流（Redis 计数，20 封/分钟），叠加已有单邮箱 60s 冷却 + 每小时 5 封 + IP 10/min | 测试通过 |
| 5 | devCode 登录 OTP 直出模式 | 后端 auth.service 3 处 devCode 增加 `NODE_ENV !== "production"` 守卫；前端 login/register 3 处同样守卫（生产构建自动 tree-shake） | tsc 通过；测试通过 |
| 6 | 401 未登录 vs 已过期 vs 用户不存在 消息区分（枚举信号） | `auth.guard.ts` 统一为「登录状态已失效，请重新登录」 | common 构建+测试通过 |

## 待用户操作（Helius key 轮换）

- devnet key `829d9591-…aa5b`：已在多台机器/生产配置中出现，**请在 Helius 控制台吊销**并生成新 key。
- mainnet key `e9997065-…ebd5`：曾出现在本机 mainnet 切换配置，**建议一并吊销轮换**。
- 新 key 写入生产 `.env.app`（`SOLANA_RPC_URL`）后重启对应服务即可，无需改代码。

## 备注

- 生产 `.env.app` 当前仍使用 devnet RPC（P0-1：生产跑 devnet）。本轮未切换主网（主网合约/池尚未部署初始化），切换需按 `docs/GO-LIVE-RUNBOOK.md` 流程执行。
