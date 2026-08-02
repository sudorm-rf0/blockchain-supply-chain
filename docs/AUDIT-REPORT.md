# 项目审计报告

日期：2026-08-02
审计方式：静态代码审查 + 自动化检查（构建、单测、合约测试、依赖审计、压测、链上冒烟）
范围：Solana/Anchor 合约、NestJS 后端、Next.js 前端、部署与运维配置

## 结论

项目作为本地内测/演示已可用，核心业务（文件存证、订单全生命周期）真实跑通。
**不建议直接生产上线**：依赖审计存在 39 个已知漏洞（其中 14 high、0 critical），
Next.js 14 属已停止安全补丁的版本；合约未做第三方审计；生产部署未在真实集群验证。

## 严重度统计

| 级别 | 数量 | 说明 |
| --- | --- | --- |
| Critical | 0 | 已通过移除 Trezor 钱包链消除 protobufjs 远程代码执行 |
| High | 4 | Next.js 14 已知漏洞、Solana SDK 版本不匹配、合约未审计、生产部署未验证 |
| Medium | 6 | Token 存储、测试覆盖、Prisma/Node 兼容、文件存储、风控依赖、病毒扫描 |
| Low | 5 | 限流策略、默认管理员密码、LP 赎回缺失、审计保留策略、备份未演练 |

依赖审计（`pnpm audit --prod`）：39 vulnerabilities（3 low / 22 moderate / 14 high）。

## High 发现

1. **Next.js 14 无安全补丁**：`next@14.2.35` 存在多个 high 级漏洞
   （path-to-regexp 回溯、RSC DoS、WebSocket SSRF、Middleware 绕过）。
   建议上线前升级到 `next@15.5.16+` 并同步 React 19，或保持前端不直接暴露公网。
2. **Solana SDK 版本不匹配**：钱包适配器要求 `@solana/web3.js >=1.98`，
   项目固定 `1.91.3`，存在 peer 冲突与兼容风险。建议升级 `@solana/web3.js` 并回归钱包流程。
3. **合约未第三方审计**：`trade-finance` 与 `supply-chain` 只在 Anchor 测试与 localnet
   验证过，涉及资金托管/清算/费用分配，必须由独立审计方出报告。
4. **生产部署未验证**：K8s 清单/Docker/Helm 只做静态校验；TLS、备份恢复、真实 RPC、
   S3 未实测。真实集群部署前不能判定生产可用。

## Medium 发现

5. **JWT 存 localStorage**：XSS 可窃取令牌。建议 httpOnly cookie + refresh token。
6. **测试覆盖不足**：后端 8 个单测、合约 7 个用例；缺少自动化 e2e（注册→上传→审核→
   存证→订单）与 CI 中的链上冒烟。
7. **Prisma 5.15 + Node 24 BigInt 限制**：超过 2^53 的查询失败，已通过 48 位订单 ID 与
   indexer 跳过规避；建议统一 Node 20 LTS 或升级 Prisma 后移除规避。
8. **文件默认本地磁盘**：本地可用；生产必须配置 `STORAGE_DRIVER=s3`，并加生命周期策略。
9. **风控 webhook 依赖外部服务**：已实现重试与去重，但外部服务可用性需监控告警。
10. **上传文件无病毒扫描**：建议接 ClamAV/云扫描，尤其涉及单据流转。

## Low 发现

11. 全局限流 120/min 对监控抓取有影响（已对 `/health`、`/metrics` 豁免）。
12. 管理员种子密码 `Admin123!` 仅限本地，生产必须更换。
13. LP 赎回没有合约指令，提款执行目前是管理端审批闭环。
14. 审计日志无保留/归档策略，生产需按合规设置。
15. Postgres 备份有 CronJob，但未做过恢复演练。

## 已修复项（审计周期内）

- 依赖：移除 `@solana/wallet-adapter-wallets`（Trezor 链），漏洞 70 → 39，critical 归零；
  通过 overrides 升级 `multer` 至 2.1.x。
- 链上状态机：补 `release_to_seller`，修正 repay 前置状态为 `REPAYING`。
- Prisma BigInt：订单 ID 限制 48 位；indexer 跳过超范围 ID，保留后端交易签名。
- 存证：修正 `Option<Account>` 占位、重复哈希存证 409 幂等。
- 连接：请求超时、GET 重试、gzip 压缩、请求 ID、连接池上限。
- 前端：hydration 修复、会话 401 自动登出、错误边界。

## 验证记录

- 后端/前端/三个独立服务构建通过；Jest 8/8；合约 7/7 测试通过。
- 文件哈希存证真实上链（slot 2518 无错误，后端链上校验通过）。
- 订单全流程真实上链：PENDING → FUNDED → IN_TRANSIT → CUSTOMS_CLEAR →
  DELIVERED → REPAYING → SETTLED。
- 压测：files 4.5k req/s、trades 6.3k req/s、login p99 81ms、上传 532 文件/s。

## 上线前必做

1. 升级 Next.js 15.5.16+ 与 `@solana/web3.js`，重新跑钱包/上链回归。
2. 合约第三方审计并修复。
3. devnet 全流程冒烟 → staging 真实集群 → 主网。
4. 配置 S3、正式 RPC、TLS、备份恢复演练、监控告警。
