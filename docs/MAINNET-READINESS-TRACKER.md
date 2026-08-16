# 主网就绪追踪表（Mainnet Readiness Tracker）

> 更新：2026-08-16。基于 `docs/AUDIT-FULLCHAIN-20260815.md` 全部发现 + 修复进展。
> 用途：随时查看「上主网真钱交易」还差什么、每项状态。

## 一、P0 / 高严重度

| # | 发现 | 状态 | 说明 |
|---|------|------|------|
| P0-1 | 生产运行在 devnet | 🔴 未修 | VPS 仍连 `devnet.helius-rpc.com`，`ALLOW_DEVNET_RPC_IN_PRODUCTION=true`。Go-Live 前必须切主网 RPC + 正式 mint + 关开关 |
| H-1 | 订单确认端点 400 | ✅ 已修 | ConfirmSignatureDto 增加可选 `confirm`；契约测试覆盖 |
| H-2 | 翻译 IDOR | ✅ 已修 | translate 归属校验 + 公开接口不披露 file.id |
| H-3 | trust proxy | ✅ 已修 | nginx 全 API 透传 XFF + 4 服务 trust proxy；实测 clientIp 已真实化 |
| H-4 | 融资放款/还款零链上验证 | 🟡 需业务设计 | 需确定平台收款地址/资金流；不能零成本标记还清（前端已加二次确认，链上验证待设计） |
| H-5 | 提款零验证 | ✅ 已修 | executeWithdrawal 强制链上出金签名验证（USDC 转账指令匹配）；前端填写出金 txSignature |
| H-6 | 生产默认口令 | ✅ 已修 | seed 拒绝默认/纯字母数字口令；模板删默认口令 |
| H-7 | 合约无 PENDING 取消/退款 | 🔴 未修 | 合约层需新增指令 + 外部审计 + 多签；买方 30% 首付长期锁定风险 |

## 二、中危（审计报告三）

| 项 | 状态 | 说明 |
|----|------|------|
| 换绑邮箱只验新邮箱 | ✅ 已修 | 新旧邮箱双验证码校验 |
| FileCompareDialog iframe XSS | ✅ 已修 | sandbox="allow-scripts" |
| 金额浮点精度 | 🟡 待处理 | 涉及 trade/new/dashboard/financing，需十进制化改造（资金路径谨慎） |
| 上传相机绕过校验 | ✅ 已修 | onDrop maxSize 兜底 |
| 敏感操作无二次确认 | ✅ 已修 | 角色变更/融资还款加确认；提款需签名 |
| 登出不彻底 | 🟡 待处理 | 全局会话架构改造 |
| Sidebar SSR 水合 | ✅ 已修 | 用 useSearchParams 替代 window |
| 批量审核跨页残留 | 🟡 待处理 | admin/files（并行活跃文件） |
| 登录失败锁定 DoS | ⚠️ 缓解 | trust proxy 后按真实 IP，仍需监控 |
| devCode 单防线 | ✅ 已具 | 生产 fail-closed |
| Turnstile 未配置静默跳过 | ⚠️ 缓解 | 生产已配置 |
| CSV 公式注入 | ✅ 已修 | escape 加单引号前缀 |
| 监控 label 基数 | 🟡 待处理 | 运维项 |
| 公开核验过度披露 | ✅ 已修 | 不披露 id |
| 索引器 sync 竞态 | 🟡 待处理 | 并发读-改-写 |
| 文件版本自增竞态 | 🟡 待处理 | files 并行活跃 |
| LP_MINT 默认=USDC | ⚠️ 已缓解 | 生产已区分；**主网 LP mint 需决策** |
| createTrade 重复订单竞态 | ⚠️ 缓解 | 已有幂等键 + Conflict；彻底需事务锁 |

## 三、测试质量

| 缺口 | 状态 | 说明 |
|------|------|------|
| 前端 API 层覆盖率 0% | ✅ 已修 | 新增 trades/auth/files/pool/admin-api 契约测试（38 用例） |
| e2e 仅 5 用例 | 🟡 待补充 | 需覆盖资金核心旅程 |
| 后端 branch 阈值 | 🟢 持续 | 270 用例全过 |

## 四、上主网剩余硬性事项（按序）

1. **主网环境切换**：主网 RPC（非 devnet）+ 关闭 `ALLOW_DEVNET_RPC_IN_PRODUCTION` + 后端 `.env.app` 指向主网 USDC/LP mint
2. **部署钱包注资**：正式 Program 已生成（见下），部署钱包需 ≥1 SOL（当前 0 SOL，precheck FAIL）
3. **LP mint 决策**：主网 LP 代币 mint 需铸造并配置（当前 dry-run 用 USDC 占位）
4. **H-4 / H-7**（业务 + 合约 + 外部审计）
5. **外部专业审计**（合约 + 全链路）
6. **KYC/AML**（真钱合规）
7. **多签主网演练**：`--upgrade-authority <MULTISIG_PDA>` 交多签
8. **灾难恢复演练**：备份恢复、reconcile、rollback

## 五、主网 dry-run 演练结果（2026-08-16）

- 正式 Program keypair 已生成本地：`packages/contracts/target/deploy/mainnet/`
  - trade: `5vLATpPELYKvVZhzDtxFwWxknFMQ2ozGjXCa6EHfnJ1E`
  - supply: `D6yRznXTGYRPGCNWQy1ihnNx9y9MdPcYqam1pnfeq6uM`
  - ⚠️ **这两个 keypair 是主网程序升级权限密钥，seed phrase 需离线备份，切勿提交/泄露**
- `precheck-mainnet-deploy.sh`：program ids / usdc mint / pool state 全 PASS；部署钱包余额 FAIL（0 SOL，注资后重跑）
- 部署命令序列已验证（dry-run 预览完整）

## 附：生成的主网密钥安全提醒

- keypair 文件在 `target/deploy/mainnet/`（gitignored），但为安全应移至离线冷存储
- 部署完成后建议 `--freeze-upgrade-authority` 或 `--upgrade-authority <MULTISIG_PDA>` 冻结升级权限
