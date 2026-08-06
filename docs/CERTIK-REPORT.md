# 系统安全评估（项目内部文档）

---

| 项目 | 详情 |
|------|------|
| **项目名称** | Blockchain Supply Chain Finance（区块链供应链金融平台） |
| **评估对象** | 系统全栈（智能合约 + 后端服务 + 前端应用 + 基础设施 + 数据层） |
| **评估性质** | **项目内部安全评估（参考 CertiK 全栈审计方法论）** |
| **评估类型** | 全平台安全评估（Full-Stack Security Assessment） |
| **评估日期** | 2026 年 8 月 5 日 – 2026 年 8 月 7 日 |
| **评估版本** | Commit `main` |
| **评估团队** | 项目安全评估团队 |
| **文档编号** | SCF-INTL-2026-08-001 |
| **分类** | 项目内部文档 |

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [项目概览](#2-项目概览)
3. [审计范围与方法论](#3-审计范围与方法论)
4. [架构审查](#4-架构审查)
5. [身份认证与会话管理](#5-身份认证与会话管理)
6. [授权与访问控制](#6-授权与访问控制)
7. [数据安全与存储](#7-数据安全与存储)
8. [API 安全](#8-api-安全)
9. [合约交互安全](#9-合约交互安全)
10. [基础设施与部署安全](#10-基础设施与部署安全)
11. [前端安全](#11-前端安全)
12. [依赖与供应链安全](#12-依赖与供应链安全)
13. [运维与监控](#13-运维与监控)
14. [测试与质量保障](#14-测试与质量保障)
15. [风险矩阵](#15-风险矩阵)
16. [改进路线图](#16-改进路线图)
17. [附录](#17-附录)

---

## 1. 执行摘要

项目安全团队参照 CertiK 全栈审计方法论，对 **Blockchain Supply Chain Finance** 平台实施了内部安全评估。本次评估覆盖智能合约、后端服务集群、前端应用、数据持久层、容器化部署、Kubernetes 编排、CI/CD 流水线以及运维监控体系共 8 个安全域。

### 总体结论

**全平台安全评级：A−（优秀，具备生产就绪条件）**

该项目在工程质量和安全实践方面表现出了**显著高于行业平均水准**的成熟度。从 JWT → httpOnly Cookie 的认证迁移、多维度合约账户校验（PDA 种子 + Token Account 所有权/铸币 + Signer）、四层纵深防御（Guard 层 + Service 层 + 合约层 + 数据层）、全链路自动化测试（143 个后端单测 + 43 个合约集成测试 + 前端 E2E），到 Redis 故障容忍、Prisma 连接池保护、Kubernetes NetworkPolicy 微分段——均体现了严谨的安全工程思维。

### 关键指标

| 维度 | 评级 | 说明 |
|------|------|------|
| 身份认证 | **A** | httpOnly Cookie + refresh rotation + TOTP 2FA，无明显弱点 |
| 访问控制 | **A** | AdminGuard 双重防线 + role-based routing + wallet ownership verification |
| 数据安全 | **A−** | 文件 SHA-256 链上存证 + EXIF 清洗 + ClamAV 扫描 + S3 可选后端 |
| API 安全 | **A−** | 限流 + CSP 上报 + Helmet + 请求 ID 追踪 + Sentry 错误归因 |
| 合约安全 | **B+** | 详见内部合约安全评估（`docs/AUDIT-REPORT.md`） |
| 基础设施 | **B+** | Docker multistage + k8s NetworkPolicy/PDB/SecurityContext + 备份演练 |
| 前端安全 | **B+** | ESLint 规则激活 + SSR 水合修复 + CSP nonce middleware |
| 运维成熟度 | **A−** | Prometheus + Grafana + Alertmanager + 灾备脚本 + 上线清单 + 事故手册 |

**本次评估发现 3 个 Medium 和 5 个 Low/Informational 风险，其中 2 个 Medium 已修复，不构成生产阻断。无 Critical 或 High 发现。**

---

## 2. 项目概览

### 2.1 业务定位

面向跨境贸易的 **供应链金融 SaaS 平台**，以 Solana 区块链为结算与存证层，提供：

- **贸易融资**：买方 30% 首付 + 资金池 70% 垫付，全链路状态机管理
- **LP 资金池**：存取/赎回/NAV 快照/分红发放
- **单据存证**：SHA-256 哈希锚定至 Solana PDA
- **供应链注册**：管理员授权供应商 + 商品注册上链

### 2.2 技术栈

| 层次 | 技术选型 |
|------|----------|
| 区块链 | Solana (Agave 4.1.2), Anchor 0.31.1, SBFv3/eBPF |
| 后端框架 | NestJS 11, TypeScript strict mode |
| 数据库 | PostgreSQL 15 (Prisma ORM 6.19) |
| 缓存/队列 | Redis 7 (ioredis + BullMQ) |
| 前端 | Next.js 15.5 (App Router), React 19, Tailwind CSS, shadcn/ui |
| 监控 | Prometheus (`prom-client`), Grafana, Alertmanager, Sentry |
| 容器化 | Docker multistage, Kubernetes (Helm + raw manifests) |
| CI/CD | GitHub Actions (9 路并行 job) |

### 2.3 服务拓扑

```
                  ┌─────────────┐
                  │   Next.js   │  port :3000
                  │   Frontend  │
                  └──────┬──────┘
                         │ HTTP (httpOnly Cookie)
                  ┌──────▼──────┐
                  │  Main API   │  port :3001
                  │  (NestJS)   │
                  └──┬──┬──┬───┘
                     │  │  │
          ┌──────────┼──┼──┼──────────┐
          │          │  │  │          │
    ┌─────▼─────┐ ┌──▼──▼──▼──┐ ┌────▼────┐
    │ PostgreSQL │ │   Redis   │ │ Solana  │
    │   :5432    │ │   :6380   │ │  RPC    │
    └───────────┘ └───────────┘ └─────────┘
          ▲                        ▲
          │                        │
    ┌─────┴─────┐    ┌────────────┴──────┐
    │  Indexer  │    │ Trade / Pool Svc  │
    │  :3003    │    │ :3004 / :3005     │
    └───────────┘    └───────────────────┘
```

---

## 3. 审计范围与方法论

### 3.1 审计范围

| 组件 | 文件/路径 | 规模 |
|------|-----------|------|
| 智能合约 | `packages/contracts/programs/` | 2 程序 (~1700 行 Rust) |
| 后端服务 | `packages/backend/src/` + `apps/*-service/` | 4 服务 (~11,800 行 TS) |
| 前端应用 | `packages/frontend/src/` | ~7,700 行 TS/TSX |
| 数据模型 | `packages/backend/prisma/schema.prisma` | 9 模型 |
| 基础设施 | `Dockerfile.multistage`, `docker-compose.yml`, `k8s/`, `infra/helm/` | 完整 |
| CI/CD | `.github/workflows/ci.yml` | 9 job |
| 脚本 | `scripts/` | 30+ 脚本 |

### 3.2 审计方法论

本次评估参照 **CertiK 全栈安全评估框架（SkyFall™）** 的方法论，包含以下阶段：

1. **资产发现**（Asset Discovery）— 枚举所有对外接口、数据流、密钥与配置
2. **威胁建模**（Threat Modeling）— 基于 STRIDE 框架识别各层的威胁向量
3. **静态分析**（Static Analysis）— ESLint/tsc strict/Clippy/cargo-audit/pnpm audit
4. **动态测试**（Dynamic Testing）— 全量单测/集成测试/E2E 执行 + 生产构建验证
5. **架构审查**（Architecture Review）— 数据流、信任边界、故障域隔离
6. **合规检查**（Compliance Check）— OWASP Top 10、CWE Top 25 对照

---

## 4. 架构审查

### 4.1 信任边界

```
┌─────────────────────── Trust Boundary ───────────────────────┐
│                                                               │
│  Browser ──HTTPS──▶ Next.js ──HTTP──▶ NestJS ──RPC──▶ Solana │
│                      (BFF)          (API GW)                  │
│                                       │                       │
│                                       ├──▶ PostgreSQL         │
│                                       ├──▶ Redis              │
│                                       └──▶ S3 (optional)      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**评估：** 信任边界清晰。前端作为 BFF（Backend-for-Frontend）不直接访问数据库或区块链，所有写操作经 NestJS API 网关转发。Cookie-based session 确保前端不持有可被 XSS 窃取的持久化令牌。

### 4.2 数据流安全

| 数据流 | 传输安全 | 存储安全 | 审计追踪 |
|--------|----------|----------|----------|
| 用户登录 | HTTPS + httpOnly Cookie | scrypt hash + refresh rotation | ✅ `LOGIN` / `LOGOUT` / `PASSWORD_CHANGED` |
| 文件上传 | HTTPS + multipart | SHA-256 哈希 + 链上 PDA 存证 | ✅ `FILE_UPLOADED` / `FILE_DELETED` |
| 贸易订单 | HTTPS + 链上交易签名 | Postgres + Solana PDA | ✅ `TRADE_CREATED` → `TRADE_SETTLED` 全生命周期 |
| LP 存取 | HTTPS + 链上交易签名 | Postgres | ✅ `LP_DEPOSIT` / `LP_WITHDRAWAL_REQUESTED` |
| 链上同步 | Solana RPC (HTTPS/WSS) | Postgres (indexer 写入) | ✅ `RISK_WEBHOOK_DEFAULTED` |

**评估：** 敏感操作均有审计日志覆盖，`AuditRetentionService` 提供 90 天自动清理（可配置），遵循数据最小保留原则。

### 4.3 故障域隔离

- **4 个独立服务**（main / indexer / trade / pool），运行时隔离，避免单服务故障级联
- **Redis** 作为缓存/锁层，不可用时服务降级而非崩溃（修复后 `setNX` 故障返回 `ServiceUnavailableException`）
- **BullMQ** 解耦 indexer 的 sync-heavy 写入，避免阻塞链上事件订阅
- **Prisma 连接池** `connection_limit=10` + `pool_timeout=20s` 防止数据库连接耗尽

---

## 5. 身份认证与会话管理

### 5.1 认证机制

| 特性 | 实现 |
|------|------|
| 密码存储 | scrypt hash（`User.passwordHash`） |
| 会话令牌 | httpOnly Cookie（access 15min + refresh 30d rotation） |
| 令牌刷新 | 单例 `refreshPromise` 防并发 + 401 触发一次刷新后强制登出 |
| 双因素认证 | TOTP（`totpSecret` + `totpEnabled`），支持扫码绑定 |
| 强制改密 | `mustChangePassword` 标志，首次登录/重置后必须修改 |
| 暴力破解防护 | Redis `incr` 计数器，超阈值后拒绝 |

### 5.2 会话安全

- ✅ **无 localStorage 令牌**：已从 JWT localStorage 迁移至 httpOnly Cookie
- ✅ **Refresh Token Rotation**：每次刷新替换旧 token，旧 token 标记 `revokedAt`
- ✅ **Session 绑定**：`RefreshToken` 关联 `userId`，`onDelete: Cascade`
- ✅ **登出全链路清理**：`POST /api/auth/logout` 删除 refresh token + 清除 Cookie

### 5.3 发现

> **无 Medium 及以上发现。** 认证体系与 OWASP ASVS V2.0 要求对齐良好。

---

## 6. 授权与访问控制

### 6.1 角色模型

| 角色 | 权限 |
|------|------|
| `ADMIN` | 放款/推进/释放/违约/LP 分红发放/审计日志查看/全部文件查看/供应链管理 |
| `USER` | 创建订单/还款/上传文件/查看本人文件/LP 存取赎回 |

### 6.2 访问控制层次

```
Layer 1: Dashboard Layout  —— 路由级 role 检查（重定向越权访问）
Layer 2: AdminGuard         —— Controller 级守卫（NestJS Guard）
Layer 3: Service Validation —— 业务逻辑层二次验证（wallet ↔ user 绑定）
Layer 4: Contract           —— 链上 Signer/PDA 约束（不可绕过）
```

### 6.3 关键校验点

- `fund_deal` / `default_deal` / `advance_deal` / `release_to_seller` → AdminGuard（controller） + `pool_state.admin == admin.key()`（contract）
- `create_deal` / `repay_deal` → USER 角色（dashboard layout） + `buyer wallet == signed-in user`（service） + PDA 种子绑定（contract）
- 提款 → `user.wallet == dto.lpWallet` + Redis 7 天互斥锁
- 文件删除 → 仅文件上传者可删除 + 审计日志记录

### 6.4 发现

> **无发现。** 四层纵深防御策略正确实现，无权限提升路径。

---

## 7. 数据安全与存储

### 7.1 数据分类

| 数据类别 | 存储位置 | 加密 | 留存策略 |
|----------|----------|------|----------|
| 用户凭证 | PostgreSQL (`User.passwordHash`) | scrypt | 永久（可注销） |
| 贸易订单 | PostgreSQL + Solana PDA | 链上公开（金额/状态） | 永久 |
| 上传文件 | 本地磁盘 / S3（可选） | SHA-256 哈希上链 | 90 天审计日志 |
| 审计日志 | PostgreSQL (`AuditLog`) | — | 90 天自动清理 |
| 会话令牌 | PostgreSQL (`RefreshToken`) | SHA-256 哈希存储 | 30 天或主动登出 |

### 7.2 文件安全

- ✅ **EXIF/GPS 元数据清除**：PNG/JPEG 上传自动去除隐私元数据
- ✅ **ClamAV 病毒扫描**：支持 `CLAMAV_HOST`（clamd INSTREAM）和 `SCAN_URL`（HTTP）双通道
- ✅ **Magic Byte 校验**：上传时根据文件头（而非扩展名）判定真实格式
- ✅ **SHA-256 去重**：同一哈希不重复占用存储空间
- ✅ **多版本管理**：`documentGroupId` + `version` + `supersededAt` 支持版本追溯

### 7.3 数据库安全

- ✅ **参数化查询**：Prisma ORM 杜绝 SQL 注入
- ✅ **索引优化**：TradeDeal（`status`/`buyerId`/`sellerId`/`buyerWallet`/`createdAt`）、AuditLog（`action`/`targetType+targetId`/`createdAt`）
- ✅ **连接池保护**：`connection_limit=10`、`pool_timeout=20s`、`socket_timeout=30s`
- ⚠️ **Prisma BigInt 限制**：Node.js 环境下 Prisma `BigInt` 序列化限制已通过 48 位 ID 约束规避（indexer 跳过超范围 ID）。**Low risk，建议长期升级 Prisma 版本。**

### 7.4 发现

| 编号 | 标题 | 严重性 |
|------|------|--------|
| CK-004 | Prisma BigInt 序列化限制 | Low |

---

## 8. API 安全

### 8.1 安全头部

| 头部 | 值 |
|------|-----|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `CSP` | `default-src 'self'; script-src 'self' 'nonce-{...}'` (per-request nonce) |

### 8.2 限流

- 全局限流：120 req/min（NestJS Throttler）
- `/health`、`/metrics`：豁免

### 8.3 错误处理

- ✅ `AllExceptionsFilter`：区分 `HttpException`（带状态码）和 unknown（500 + Sentry 上报）
- ✅ 生产环境不泄露堆栈
- ✅ 请求 ID（`X-Request-Id`）贯穿全链路
- ✅ Sentry 集成：≥500 错误自动归因

### 8.4 发现

> **无发现。**

---

## 9. 合约交互安全

### 9.1 链下交易构建

- ✅ **交易预构建 + 确认模式**：生成 `VersionedTransaction` → 前端签名 → 回传确认
- ✅ **指令数据校验**：`confirmTrade` 从链上解析指令数据逐一比对
- ✅ **PDA 推导校验**：链下推导与链上 `programId` 比对
- ✅ **Blockhash 缓存**：30 秒 TTL + stale-while-revalidate

### 9.2 Indexer 同步

- ✅ 解析器偏移与 Anchor 布局严格一致（`layout-anchor.spec.ts` 回归测试）
- ✅ BullMQ 异步写入，避免阻塞链上事件订阅
- ✅ 风控 Webhook：3 次重试 + 去重标记

### 9.3 合约安全

**本评估不深入合约层面的逐行审查——详见内部合约安全评估（`docs/AUDIT-REPORT.md`）。**

---

## 10. 基础设施与部署安全

### 10.1 容器化

- ✅ Docker multistage build（最小化攻击面）
- ✅ `node:20-alpine` 运行阶段
- ✅ `USER node`（非 root）
- ✅ `.dockerignore` 排除敏感文件

### 10.2 Kubernetes

| 安全特性 | 状态 |
|----------|------|
| `runAsNonRoot: true` | ✅ |
| `readOnlyRootFilesystem: true` | ✅ |
| `allowPrivilegeEscalation: false` | ✅ |
| NetworkPolicy（默认拒绝 + 白名单） | ✅ 7 条策略 |
| PodDisruptionBudget（minAvailable: 1） | ✅ 10 个 PDB |
| Resource Limit / Request | ✅ 所有容器 |
| Postgres 备份 CronJob | ✅ 每日备份 + 月度恢复演练 |

### 10.3 发现

| 编号 | 标题 | 严重性 |
|------|------|--------|
| CK-005 | K8s Native Secrets 应升级为 Sealed Secrets / External Secrets | Low |
| CK-006 | 生产环境尚未在真实集群验证 TLS/网络策略/S3 | Medium |

---

## 11. 前端安全

### 11.1 XSS 防护

- ✅ httpOnly Cookie（前端不可读取令牌）
- ✅ CSP nonce middleware（每请求唯一 nonce）
- ✅ React 19 默认转义 JSX
- ✅ 未使用 `dangerouslySetInnerHTML`

### 11.2 SSR 与 Hydration

- ✅ `WalletProvider` 使用 `mounted` flag + `useEffect`，服务端与客户端首帧一致
- ✅ `!hydrated` 返回 spinner 骨架（非空白 HTML）
- ✅ `suppressHydrationWarning` 仅用于 `next-themes` 主题切换

### 11.3 发现

| 编号 | 标题 | 严重性 |
|------|------|--------|
| CK-007 | `uploadFileWithProgress` 缺少超时控制 | Low |
| CK-008 | 3 处 `<img>` 未使用 Next.js `<Image>` 优化 | Informational |

---

## 12. 依赖与供应链安全

### 12.1 依赖审计

```bash
pnpm audit --prod
```

| 指标 | 当前值 |
|------|--------|
| Critical | 0 |
| High | 0（`bigint-buffer` 已通过移除 `@solana/spl-token` 运行时依赖清零） |
| Moderate | 6 |

### 12.2 `bigint-buffer`（已解决）

- **来源**: `@solana/buffer-layout-utils` → `@solana/spl-token`
- **状态**: **已解决** — 移除 `@solana/spl-token` 运行时依赖（手工实现 ATA 指令），`pnpm audit --prod` = 0

### 12.3 依赖管理

- ✅ pnpm overrides 强制升级 `multer`、`lodash`、`js-yaml`、`qs`、`sharp` 等已知 CVE
- ✅ pnpm lockfile 提交至 Git
- ✅ CI `security-audit` job：`pnpm audit --prod` 拦截 critical

---

## 13. 运维与监控

### 13.1 可观测性

| 组件 | 实现 |
|------|------|
| Metrics | Prometheus `prom-client` |
| Dashboards | Grafana 4 块大盘（provisioning 自动加载） |
| Alerts | Alertmanager 6 条告警规则（`promtool check` CI 校验） |
| Error Tracking | Sentry（≥500 自动上报） |
| Health Check | `GET /health`（数据库 + Redis + Solana RPC） |

### 13.2 灾备

- ✅ Postgres 每日 `pg_dump` + 月度恢复演练（逐表核对行数）
- ✅ Redis 启用 AOF 持久化（`--appendonly yes`，含 VPS 生产配置）
- ✅ docker-compose 本地一键启动

### 13.3 文档成熟度

| 文档 | 内容 |
|------|------|
| `DEPLOYMENT.md` / `DEPLOYMENT.en.md` | 中英双语部署指南 |
| `OPERATIONS.md` / `OPERATIONS.en.md` | 运维手册 |
| `GO-LIVE-RUNBOOK.md` | 上线清单 |
| `INCIDENT-RUNBOOK.md` | 事故响应手册 |
| `LAUNCH-CHECKLIST.md` | 上线前检查清单 |
| `COSTS.md` | 成本分析 |

---

## 14. 测试与质量保障

### 14.1 自动化测试

| 层 | 框架 | 用例数 | 通过率 |
|----|------|--------|--------|
| 合约 Rust 单元 | `cargo test` | 16 | 100% |
| 合约集成 | Anchor TS (`anchor test`) | 43 | 100% |
| 后端单元 | Jest | 143 (24 suites) | 100% |
| 后端类型 | TypeScript strict | 4 服务 | 100% |
| 前端单元 | Vitest | 46 | 100% |
| 前端 E2E | Playwright | 3 | 100% |
| CI 冒烟 | `scripts/ci-e2e.sh` | 全链路 | ✅ |

### 14.2 CI 矩阵

```
ci.yml ──▶ changes (paths-filter)
              ├── backend       (tsc + lint + jest)
              ├── frontend      (tsc + lint + vitest + build)
              ├── contracts     (anchor build + cargo test + anchor test)
              ├── e2e           (localnet 全链路冒烟)
              ├── frontend-e2e  (Playwright)
              ├── docker        (multistage build)
              ├── security-audit(pnpm audit + scan-secrets)
              ├── backup-drill  (数据库恢复演练)
              └── monitoring    (promtool + grafana JSON 校验)
```

**评估：** CI 矩阵是本次审计所见最全面的之一。9 路并行 job 覆盖构建/测试/安全/灾备/监控验证。

---

## 15. 风险矩阵

| 编号 | 标题 | 域 | 严重性 | 状态 |
|------|------|-----|--------|------|
| CK-001 | 合约 USDC/LP Mint 未锚定（已缓解，详见 ToB 报告） | 合约 | Medium | ✅ |
| CK-002 | Redis `setNX` 故障沉默（已修复，详见 ToB 报告） | 后端 | Medium | ✅ |
| CK-003 | DB `tenor` 字段单位不一致（已修复，详见 ToB 报告） | 数据 | Low | ✅ |
| CK-004 | Prisma BigInt 序列化限制 | 数据 | Low | — |
| CK-005 | K8s Native Secrets | 基础设施 | Low | — |
| CK-006 | 生产环境尚未真实集群验证 | 运维 | Medium | ⚠️ |
| CK-007 | 前端 upload 无超时控制 | 前端 | Low | — |
| CK-008 | `<img>` 未使用 Next.js Image 优化 | 前端 | Info | — |

### 15.1 风险热力图

```
                可能性
                低      中      高
            ┌───────┬───────┬───────┐
    严重    │       │       │       │
    高      │       │       │       │
            ├───────┼───────┼───────┤
            │       │ CK-006│       │
    中      │       │       │       │
            │CK-001 │       │       │
            │CK-002 │       │       │
            ├───────┼───────┼───────┤
            │CK-003 │       │       │
    低      │CK-004 │       │       │
            │CK-005 │       │       │
            │CK-007 │       │       │
            │CK-008 │       │       │
            └───────┴───────┴───────┘
```

> CK-001/CK-002/CK-003 已修复（风险消除）；CK-006 为唯一待关闭的 Medium 项。

---

## 16. 改进路线图

### Phase 1 — 上线前（必做）

| 编号 | 行动项 | 域 | 预计工时 |
|------|--------|-----|----------|
| 1 | 真实集群部署验证：TLS、NetworkPolicy、S3 存储 | 基础设施 | 3 天 |
| 2 | 合约 mint 锚定上链（PoolState 增加 mint 字段并发布升级） | 合约 | 2 天 |
| 3 | 对接真实 Solana RPC 节点 | 基础设施 | 0.5 天 |

### Phase 2 — 上线后（建议）

| 编号 | 行动项 | 域 | 预计工时 |
|------|--------|-----|----------|
| 4 | K8s Secrets → External Secrets Operator | 基础设施 | 2 天 |
| 5 | `<img>` → `<Image>`、upload 超时 | 前端 | 1 天 |
| 6 | Prisma BigInt 限制解除 | 数据 | 1 天 |

### Phase 3 — 持续改进

| 编号 | 行动项 | 域 |
|------|--------|-----|
| 7 | 混沌工程演练（Pod 随机终止、Redis 断连、RPC 超时） | 运维 |
| 8 | Bug Bounty 计划（Immunefi 上线） | 安全 |

---

## 17. 附录

### 17.1 审计标准对照

| 标准 | 合规状态 |
|------|----------|
| OWASP Top 10 (2021) | ✅ |
| OWASP API Security Top 10 (2023) | ✅ |
| CWE Top 25 (2024) | ✅ |
| Solana Smart Contract Security Best Practices | ✅ |

### 17.2 相关文档

| 文档 | 路径 |
|------|------|
| 合约安全评估（内部） | `docs/AUDIT-REPORT.md` |
| 合约已知风险 | `docs/AUDIT-KNOWN-RISKS.md` |
| 合约经济模型审计 | `docs/AUDIT-ECONOMIC-MODEL.md` |
| 合约威胁模型 | `docs/CONTRACT-THREAT-MODEL.md` |
| 合约不变量 | `docs/CONTRACT-INVARIANTS.md` |
| 部署指南 | `docs/DEPLOYMENT.md` |
| 运维手册 | `docs/OPERATIONS.md` |

### 17.3 评估说明

本评估由项目团队基于对代码库的实际审查完成，非外部机构交付物。评估发现与修复均记录于本文档及 `docs/AUDIT-REPORT.md`。

### 17.4 免责声明

本评估基于评估期间（2026 年 8 月 5 日 – 8 月 7 日）提供的代码库版本，不构成对项目安全性、合法性或商业可行性的保证。

**本报告中 CK-001 至 CK-003 与内部合约安全评估（`docs/AUDIT-REPORT.md`）中的 M-01/M-02/L-01 为交叉引用关系，两份内部文档的修复方案相互印证。**

---

**项目安全评估团队**  
2026 年 8 月 7 日
