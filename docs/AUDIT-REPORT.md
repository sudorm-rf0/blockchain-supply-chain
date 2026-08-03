# 项目审计报告

日期：2026-08-04（上一版 2026-08-02）
审计方式：静态代码审查 + 自动化检查（构建、单测、合约测试、依赖审计、压测、链上冒烟）
范围：Solana/Anchor 合约、NestJS 后端、Next.js 前端、部署与运维配置

## 结论

项目作为本地内测/演示已可用，核心业务（文件存证、订单全生命周期）真实跑通。
**不建议直接生产上线**：依赖审计存在 39 个已知漏洞（其中 14 high、0 critical），
前端已升级到 Next.js 15.5.22 + React 19；依赖审计仍有 1 个无补丁的 high
（`bigint-buffer`，来自 `@solana/spl-token` 原生依赖）；合约未做第三方审计；
生产部署未在真实集群验证。

## 严重度统计

| 级别 | 数量 | 说明 |
| --- | --- | --- |
| Critical | 0 | 已通过移除 Trezor 钱包链消除 protobufjs 远程代码执行 |
| High | 4 | Next.js 14 已知漏洞（已升级 15.5.22 修复）、Solana SDK 版本不匹配、合约未审计、生产部署未验证 |
| Medium | 6 | Token 存储、测试覆盖、Prisma/Node 兼容、文件存储、风控依赖、病毒扫描 |
| Low | 5 | 限流策略、默认管理员密码、LP 赎回缺失、审计保留策略、备份未演练 |

依赖审计（`pnpm audit --prod --registry https://registry.npmjs.org`）：
2 vulnerabilities（1 moderate / 1 high）。

## High 发现

1. ~~Next.js 14 无安全补丁~~ **已修复**：升级到 `next@15.5.16` + React 19，
   页面构建与浏览器 hydration 回归通过。
2. ~~Solana SDK 版本不匹配~~ **已修复**：升级 `@solana/web3.js` 至 1.98.4，
   前后端构建、合约 typecheck、全链路冒烟通过。
3. **合约未第三方审计**：`trade-finance` 与 `supply-chain` 只在 Anchor 测试与 localnet
   验证过，涉及资金托管/清算/费用分配，必须由独立审计方出报告。
4. **生产部署未验证**：K8s 清单/Docker/Helm 只做静态校验；TLS、备份恢复、真实 RPC、
   S3 未实测。真实集群部署前不能判定生产可用。

## Medium 发现

5. **JWT 存 localStorage**：XSS 可窃取令牌。建议 httpOnly cookie + refresh token。
   **已修复**：迁移为 httpOnly Cookie（access 15 分钟 + refresh 30 天轮换），
   前端不再持久化 token；管理员初始密码强制改密；删除文件/执行提款仍要求
   显式二次确认并写入审计日志。
6. **测试覆盖不足**：后端 8 个单测、合约 7 个用例；缺少自动化 e2e（注册→上传→审核→
   存证→订单）与 CI 中的链上冒烟。
   **已扩充**：后端 Jest 63 个用例（trade/pool/indexer 边界、Cookie 会话、改密、二次确认），
   合约 20 个用例（非法跳转、0 金额、重复还款、超额拨款、非管理员拨款等），
   CI 已包含 localnet 全链路冒烟与 Docker 构建。
7. **Prisma 5.15 + Node 24 BigInt 限制**：超过 2^53 的查询失败，已通过 48 位订单 ID 与
   indexer 跳过规避；建议统一 Node 20 LTS 或升级 Prisma 后移除规避。
8. **文件默认本地磁盘**：本地可用；生产必须配置 `STORAGE_DRIVER=s3`，并加生命周期策略。
9. **风控 webhook 依赖外部服务**：已实现重试与去重，但外部服务可用性需监控告警。
10. **上传文件无病毒扫描**：建议接 ClamAV/云扫描，尤其涉及单据流转。

## Low 发现

11. 全局限流 120/min 对监控抓取有影响（已对 `/health`、`/metrics` 豁免）。
12. 管理员种子密码 `Admin123!` 仅限本地，生产必须更换。
13. ~~LP 赎回没有合约指令~~ **已实现**：`redeem_lp` 支持链上按 NAV 赎回，
    并带单次上限与保险池保护；管理端 7 天提款审批闭环保留。
14. 审计日志无保留/归档策略，生产需按合规设置。
15. ~~Postgres 备份未做过恢复演练~~ **已修复**：`scripts/db-backup-restore.sh`
      支持一键 drill，真实备份恢复到临时库并逐表核对，输出 JSON 恢复验证报告。
16. K8s `securityContext` 已补齐（backend/frontend/indexer/trade/pool：
    `runAsNonRoot`、UID/GID 1000、`fsGroup`、`allowPrivilegeEscalation: false`、
    drop ALL）；`NetworkPolicy` 与 PodDisruptionBudget 仍需真实集群部署验证。
17. 前端未启用 CSP：App Router 内联脚本需要 nonce 方案，当前已有
    `X-Content-Type-Options` / `Referrer-Policy` / `Permissions-Policy` 兜底。

## 已修复项（审计周期内）

- 状态机补全：`default_deal` 允许 REPAYING 且账期已到期的订单违约
  （`created_at + tenor` 超时判断），新增 `DealNotExpired` 错误码与
  Rust 单元测试；未到期 REPAYING 违约被拒绝，合约测试增至 23 个。

- 依赖：新增 `qs` override 至 6.15.2，修复 express/body-parser 传递依赖的
  远程 DoS（GHSA-q8mj-m7cp-5q26），生产依赖漏洞 7 → 6。
- 依赖：新增 `uuid` override 至 11.1.1，修复 uuid v3/v5/v6 越界检查
  （GHSA-w5hq-g745-h8pq），生产依赖漏洞 6 → 4。
- 依赖：新增 `file-type` override 至 21.3.2（Nest 10 通过动态 import 加载，
  兼容性已验证），修复 ASF 解析死循环与 ZIP 解压炸弹 DoS，漏洞 4 → 2。

## 依赖残余风险评估

- `bigint-buffer`（high，无补丁）：来自 `@solana/spl-token` 0.4.15（最新）的
  `@solana/buffer-layout-utils`。使用路径为 `Buffer.from(src)` 完整拷贝后
  解析，长度恒为 8/16 字节，不接收攻击者可控越界输入；等待上游移除或
  发布修复版本，不建议自行 fork override。
- `@nestjs/core`（moderate）：修复仅存在于 Nest 11.1.18+。升级 Nest 11 需
  同步升级 `@nestjs/common/platform-express/schedule` 并适配 Express 5
  （`path-to-regexp` v8、multer 2 等），涉及 4 个服务与全部 controller，
  回归风险高；建议作为独立升级项规划，不应在功能迭代中夹带。
- 运维：K8s 提供 `k8s/network-policies.yaml`（默认拒绝 + 网关/内部/DNS/
  外部出口放行），部署开关 `DEPLOY_NETWORK_POLICIES=1`。
- 功能：trade-service 新增还款到期通知（每 10 分钟扫描 REPAYING 超时订单，
  Redis 7 天去重，写入 `TRADE_REPAYMENT_DUE` 审计日志），2 个单测覆盖。
- 权限纵深：trade-service / pool-service 管理端点（fund/advance/default/release
  及其 confirm、提款执行、提款列表）在 controller 层补 `AdminGuard`，
  与 service 层角色校验形成双重防线，并新增 6 个 guard 单测。

- 依赖：移除 `@solana/wallet-adapter-wallets`（Trezor 链），漏洞 70 → 39，critical 归零；
  通过 overrides 升级 `multer` 至 2.1.x；随后升级 Next 15.5.16 与 `@solana/web3.js` 1.98.4，
  漏洞进一步降至 28（0 critical）；复查时前端升级到 Next 15.5.22，并通过
  pnpm overrides 修复 body-parser / path-to-regexp / lodash / js-yaml / postcss /
  sharp，最终 `pnpm audit --prod` 降至 7 个（1 high / 6 moderate，0 critical）。
- 并发幂等：trade confirm upsert 在 indexer 并发创建时偶发主键冲突，增加 P2002 按
  PDA `id` 兜底更新；连续 3 次全链路冒烟验证稳定。
- 链上状态机：补 `release_to_seller`，修正 repay 前置状态为 `REPAYING`。
- Prisma BigInt：订单 ID 限制 48 位；indexer 跳过超范围 ID，保留后端交易签名。
- 存证：修正 `Option<Account>` 占位、重复哈希存证 409 幂等。
- 连接：请求超时、GET 重试、gzip 压缩、请求 ID、连接池上限。
- 前端：hydration 修复、会话 401 自动登出、错误边界。

## 验证记录

- 后端/前端/三个独立服务构建通过；Jest 97/97（覆盖订单状态机权限与非法跳转、
  文件版本/删除权限、提款成功路径、indexer 解码异常边界）；合约 23/23 测试通过；
  前端 Vitest 11/11（新增交易状态 Toast、文件预览组件）。
- 前端新增 Vitest 组件测试 3/3、Playwright UI e2e 2/2（版本上传、管理员强制改密、
  订单详情），并接入 CI `frontend-e2e` job。
- Next.js 15.5.22 + React 19 升级后，`/orders`、`/dashboard`、`/admin/audit`
  浏览器验证 0 hydration 错误。
- 文件哈希存证真实上链（slot 2518 无错误，后端链上校验通过）。
- 订单全流程真实上链：PENDING → FUNDED → IN_TRANSIT → CUSTOMS_CLEAR →
  DELIVERED → REPAYING → SETTLED。
- 压测：files 4.5k req/s、trades 6.3k req/s、login p99 81ms、上传 532 文件/s。
- CI 全绿：backend / frontend / contracts / e2e（localnet 全链路冒烟）/ docker
  镜像构建全部通过；新增 `security-audit` 门槛（`pnpm audit --prod` 拦截
  critical）；CI actions 已升级到 Node 24 运行时（checkout v7 / setup-node v7 /
  cache v6 / pnpm v6）；localnet 验证器升级为 Agave 4.1.2（SBFv3）。
- 备份恢复演练通过：`scripts/db-backup-restore.sh drill` 输出 JSON 报告，
  7 张核心表源库/恢复库行数一致。
- 监控验证通过：`promtool check rules` 校验 6 条告警规则，四个服务 `/metrics`
  均暴露 http/process 指标；Grafana 大盘与 provisioning 配置已加入
  `infra/grafana`；CI 新增 `monitoring` job 自动校验告警规则与大盘 JSON。
- 功能完善：订单详情页（状态时间线、还款倒计时、关联单据、链上操作）、
  文件多版本（`documentGroupId` + `version` + `supersededAt`，版本历史接口）、
  手机拍照上传与移动端无横向溢出适配均已通过浏览器验证。
- 文件安全：PNG/JPEG 上传自动去 EXIF/GPS 元数据；病毒扫描支持
  `CLAMAV_HOST`（clamd INSTREAM）与 `SCAN_URL`（HTTP）双通道，失败默认拒绝。
- 数据层：Prisma 升级到 6.19.3；连接池 `connection_limit=10`、池等待
  `pool_timeout=20s`、socket 超时 `socket_timeout=30s`，Prisma 客户端开启
  warn/error 日志与 minimal 错误格式。
- 运维闭环：新增 Prometheus/Grafana/Alertmanager K8s 清单与
  `DEPLOY_MONITORING=1` 一键部署；新增月度备份恢复演练 CronJob
  （`postgres-backup-drill-cronjob.yaml`，逐表核对）。

## 上线前必做

1. 合约第三方审计并修复。
2. devnet 全流程冒烟 → staging 真实集群 → 主网。
3. 配置 S3、正式 RPC、TLS、备份恢复演练（本机演练已通过）、监控告警。
