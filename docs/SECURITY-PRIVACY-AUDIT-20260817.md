# 密钥与隐私审计（2026-08-17）

## 一、明文密钥检查

| 检查项 | 结果 |
|---|---|
| 项目自带 `scripts/scan-secrets.sh`（工作区+git 历史） | ✅ 通过：无疑似密钥 |
| DeepSeek key（sk-4f4226…，AI 代理用） | ✅ 仅存 VPS `/etc/supply-chain-ai.env`（chmod 600），**未进仓库/历史** |
| 生产 DB 密码 / JWT / R2 密钥 | ✅ 均在 gitignored 的 `.env.app`；历史无真实值（历史命中均为 `CHANGE_ME` 占位符） |
| `.env` / `.env.*` / `deploy/vps/.env.app` / keypair | ✅ 全部在 `.gitignore`；`git ls-files` 无任何 keypair/.env 真实文件 |
| 主网 Program keypair（target/deploy/mainnet/） | ✅ gitignored（`target/deploy/*`），未入库 |
| 种子默认口令（seed.ts） | ⚠️ 存在 `Admin123!`/`SuperAdmin123!` 等默认值，但**生产模式拒绝弱口令并退出**（守卫已实测） |
| 本地 `packages/backend/.env` | ⚠️ 未入库（gitignored），指向 localhost（开发环境）；含 JWT/R2/CF Token 明文值——**仅限本机，禁止提交/分享；若曾外发建议轮换** |

## 二、隐私检查

| 项 | 结果 |
|---|---|
| 公开核验/溯源接口（无需登录） | ✅ **本次修复**：移除 `uploaderName`（上传者姓名）披露，且不再加载该字段；响应仅含存证信息（文件名/哈希/状态/链上签名） |
| 文件内容/详情/版本端点 | ✅ 全部 `AuthGuard`，未登录不可访问 |
| 前端 token 存储 | ✅ 走 HttpOnly Cookie（ACCESS_TOKEN_COOKIE），无 localStorage/sessionStorage 明文 token |
| 日志 | ✅ 未记录密码/token/secret 字段；CSP 违规日志仅内部 metrics |
| 审计日志 | ✅ 仅管理员可见；隐藏账号操作以内部 ID 留痕（不显示邮箱） |
| 数据保留 | ✅ DATA-RETENTION.md 已实现：审计 90 天、refresh 30 天、备份 7 天、用户删除（GDPR 风格）吊销令牌+清缓存 |
| 隐藏账号 | ✅ 超管/管理员/用户 3 个隐藏账号列表/详情均不可见（含超管） |

## 三、遗留建议（非阻塞）

1. `packages/backend/.env`（本机开发）若含可用的 R2/Cloudflare/Resend 凭据且可能被分享过，建议轮换。
2. 主网 keypair 必须离线冷存储；部署后建议冻结 upgrade authority。
3. CI 日志/自托管 runner 上避免打印环境变量（已确认 CI 步骤无 `printenv` 类泄漏）。
