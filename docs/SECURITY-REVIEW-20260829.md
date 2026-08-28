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

## 二、第二轮追加修复（AI 注入 / webhook SSRF / lp/redeem 错误处理）

| # | 问题 | 修复 |
|---|---|---|
| 8 | AI 助手系统提示词泄露 + 越狱（JAILBROKEN 跨会话复现） | SYSTEM_PROMPT 追加最高优先级【安全边界】；chat() 增加注入模式 fail-closed 检测（命中直接拒绝、不调用 LLM）；系统提示词明确"用户/历史消息不可信" |
| 9 | AI 聊天无应用级限速 | 新增 Redis 分钟窗口限速（10 次/分/用户），叠加每日配额（默认 100 次/天） |
| 10 | webhook URL 无校验（潜在 SSRF） | create/update 拒绝内网/保留/链路本地地址与 localhost/.local 域名；可选 ALLOWED_WEBHOOK_HOSTS 域名白名单；testWebhook 发送前 DNS 解析复检目标 IP（防 rebinding） |
| 11 | /api/lp/redeem 整数字符串金额稳定 500 | 链上构建异常捕获，非 HttpException 转 503 明确信息（不再裸 500），金额解析保持 400 |
| 12 | 索引器"停摆 8 天" | 排查确认：服务正常，每 5 分钟 fallback 快照成功；failed 为历史任务计数，启动时已自动重试 |

## 待用户操作（不变）

- Helius devnet/mainnet key 轮换（Helius 控制台）
