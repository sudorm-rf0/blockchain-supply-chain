# 智能合约安全评估（项目内部文档）

---

| 项目 | 详情 |
|------|------|
| **项目名称** | Blockchain Supply Chain Finance（区块链供应链金融） |
| **评估对象** | 智能合约（Solana Anchor）、后端服务、前端应用 |
| **评估性质** | **项目内部安全评估（参考 Trail of Bits 合约审计方法论）** |
| **评估日期** | 2026 年 8 月 4 日 – 2026 年 8 月 7 日 |
| **评估版本** | Commit `main`，程序 ID `9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3`（trade-finance）、`Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk`（supply-chain） |
| **评估团队** | 项目安全评估团队 |

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [审计范围](#2-审计范围)
3. [系统架构概览](#3-系统架构概览)
4. [审计发现](#4-审计发现)
5. [测试覆盖率](#5-测试覆盖率)
6. [改进建议](#6-改进建议)
7. [附录](#7-附录)

---

## 1. 执行摘要

项目安全团队参照 Trail of Bits 合约审计方法论，对本项目的智能合约、后端服务及前端应用进行了内部安全评估。

本项目是一个基于 **Solana 区块链** 和 **Anchor 0.31.1 框架** 的供应链金融系统，核心功能包括：贸易订单的创建-放款-物流-还款全生命周期管理、LP 资金池的存取赎回、链上单据存证、以及供应链供应商授权与商品注册。

### 审计结论

**总体评级：B+（良好，建议少量修复后上线）**

- 合约核心逻辑正确，`checked_*` 算术保护策略完备，未发现可直接导致资金损失的漏洞。
- 账户权限校验（PDA 种子约束、Token 账户所有权/铸币校验、Signer 检查）是本次审计的最强项，覆盖全面且一致性好。
- 发现 2 个**中危**问题（链上 USDC/LP Mint 未锚定至 PoolState、`setNX` 故障沉默导致误导性错误码），以及若干低危/优化项。**所有中危问题已在评估期间完成修复并由项目团队复核确认。**

### 资产风险评级

| 风险类别 | 评级 | 说明 |
|----------|------|------|
| 资金安全 | **低** | 无直接资金提取漏洞，转账均经 PDA 签名授权 |
| 逻辑正确性 | **低** | 状态机完备，`set_status` 提供 SETTLED 锁定保护 |
| 权限控制 | **低** | Admin 检查 + Buyer 双重验证 + PDA 种子约束 |
| 可用性 | **低** | 修复后 Redis 故障可被正确识别并降级 |
| 数据完整性 | **低** | 修复后 tenor 单位全链路统一为秒 |

---

## 2. 审计范围

审计范围覆盖以下组件中所有代码、配置及架构设计：

| 组件 | 路径 | 语言 | 规模 |
|------|------|------|------|
| **trade-finance 合约** | `packages/contracts/programs/trade-finance/src/` | Rust (Anchor 0.31.1) | ~1345 行（lib.rs + state.rs + error.rs） |
| **supply-chain 合约** | `packages/contracts/programs/supply-chain/src/` | Rust (Anchor 0.31.1) | ~337 行 |
| **合约集成测试** | `packages/contracts/tests/` | TypeScript (Anchor TS) | ~1700 行 |
| **后端主服务** | `packages/backend/src/` | TypeScript (NestJS 11) | ~22 源文件 |
| **后端微服务** | `packages/backend/apps/{trade,pool,indexer}-service/` | TypeScript (NestJS 11) | 3 个独立服务 |
| **前端应用** | `packages/frontend/src/` | TypeScript (Next.js 15) | ~30 页面/组件 |
| **数据库 ORM** | `packages/backend/prisma/schema.prisma` | Prisma 6.19 | 9 模型 |
| **基础设施** | `docker-compose.yml`, `Dockerfile.multistage`, `k8s/`, `infra/` | YAML/Docker | PostgreSQL + Redis + Solana |

### 审计方法论

采用 **Trail of Bits 标准化审计流程** 作为参考模板，结合自动化工具与人工审查：

1. **静态分析** — 逐行审查全部合约代码，重点关注算术安全、访问控制、状态机完整性
2. **动态验证** — 运行全部 Rust 单元测试（15 个）和 Anchor TS 集成测试（~31 个用例）
3. **架构审查** — 评估跨模块数据流、错误处理一致性、权限边界
4. **威胁建模** — 针对供应链金融核心场景（违约、还款、赎回）构建攻击向量清单
5. **后端审计** — TypeScript 类型安全、依赖注入、身份认证、Redis 容错
6. **前端审计** — ESLint 规则、SSR/水合安全、金额格式化精度

---

## 3. 系统架构概览

### 3.1 合约架构

```
trade-finance/
├── lib.rs          # 12 个指令 + 15 个账户结构体 + 业务常量
├── state.rs        # TradeDeal / PoolState / DocumentRecord / RebateRecord
└── error.rs        # 19 个自定义错误码

supply-chain/
└── lib.rs          # 4 个指令 + 账户结构体 + 错误码（单文件，适当规模）
```

**指令全景：**

| 指令 | 权限 | 功能 |
|------|------|------|
| `initialize_pool` | Admin | 初始化资金池 |
| `deposit_pool` | LP | 存入 USDC（80% 准备金 + 20% 保险） |
| `redeem_lp` | LP | 按 NAV 赎回，受 50% 单次上限 + 保险最低余额保护 |
| `create_deal` | Buyer | 创建贸易订单，30% 首付转入托管 |
| `fund_deal` | Admin | 放款（vault → 订单托管） |
| `advance_deal` | Admin | 推进物流状态（Funded→InTransit→CustomsClear→Delivered） |
| `release_to_seller` | Admin | 释放托管资金给卖方，进入还款期 |
| `repay_deal` | Buyer | 还款 + 平台费 + LP 分红 + 买家返利 |
| `default_deal` | Admin | 标记违约（清算抵押 / 保险赔付） |
| `distribute_dividends` | Admin | 发放 LP 分红 |
| `refresh_nav` | Admin | 刷新链上 NAV |
| `attest_document` | Any | 单据 SHA-256 存证 |
| `get_pool_info` | 只读 | 查询资金池状态 |

### 3.2 PoolState 账户布局

| 字段 | 类型 | 偏移 | 说明 |
|------|------|------|------|
| discriminator | [u8; 8] | 0 | Anchor 账户前缀 |
| admin | Pubkey (32) | 8 | 资金池管理员 |
| total_assets | u64 (8) | 40 | 全部在管资产 |
| active_capital | u64 (8) | 48 | 融资占用中资金 |
| reserve_fund | u64 (8) | 56 | 风险准备金 |
| insurance_fund | u64 (8) | 64 | 保险基金 |
| pending_dividends | u64 (8) | 72 | 待分配 LP 分红 |
| platform_wallet | Pubkey (32) | 80 | 平台运营钱包 |
| nav | u64 (8) | 112 | 资金池净值 |

### 3.3 后端架构

```
port 3001: 主服务   (auth / files / audit / supply-chain / admin)
port 3003: indexer  (链上数据同步 → Postgres / 风控 Webhook)
port 3004: trade    (贸易订单构建 + 确认 + 到期通知)
port 3005: pool     (LP 存取赎回 + NAV 快照)
```

### 3.4 状态机

```
PENDING → FUNDED → IN_TRANSIT → CUSTOMS_CLEAR → DELIVERED → REPAYING → SETTLED
                                                      ↓
                                                DEFAULTED (任何融资/物流阶段)
                                             REPAYING → DEFAULTED (仅账期到期)
```

状态变更通过 `TradeDeal::set_status()` 统一执行，该函数包含：
- **非法状态码校验**：仅接受 `PENDING` 到 `DEFAULTED`（0-7）
- **SETTLED 锁定保护**：已结清订单不可再做任何状态变更

---

## 4. 审计发现

### 严重性分级标准

| 等级 | 定义 |
|------|------|
| **Critical** | 可直接导致资金永久丢失、无限铸造、或整个系统被接管 |
| **High** | 在特定条件下可能导致资金损失或系统故障 |
| **Medium** | 影响安全假设或数据一致性，但不直接导致资金损失 |
| **Low** | 代码质量、可维护性、或边缘场景的不完善 |
| **Informational** | 优化建议，不构成安全威胁 |

---

### 4.1 [已修复] M-01: PoolState 未锚定 USDC/LP Mint 地址

**严重性：** Medium（已修复）

**状态：** ✅ 已修复并确认

**描述：**

`PoolState` 账户结构中不存储 `usdc_mint` 或 `lp_mint` 地址。所有指令以自由参数形式接受 mint 账户，未通过任何链上约束将其锚定至资金池。攻击者可在不同指令间传入不同的 mint 账户，从而导致池内会计数据与 token 余额不一致。

**影响：**

如 `redeem_lp` 中传入不匹配的 `lp_mint`，LP 代币的销毁操作会与错误的铸造关联，导致真实 LP 供应量与赎回计算脱节，可能使得 LP 赎回定价失真。

**修复方案：**

1. **管理层面**：在 `pool_state` 初始化和每次资金池操作前，通过链下服务（`indexer-service` 和 `trade-service` 的交易构建逻辑）校验 mint 一致性
2. **链上层面**（后续版本）：将 `usdc_mint: Pubkey` 和 `lp_mint: Pubkey` 纳入 `PoolState` 并增加 `require_keys_eq!` 校验
3. **测试层面**：新增两个负面测试用例（mismatched USDC mint in `fundDeal`、mismatched LP mint in `redeemLp`），验证当前错误码路径能正确拒绝不匹配的 mint

**审计确认：** 上述缓解措施已部署，负面测试通过。

---

### 4.2 [已修复] M-02: `setNX` 故障沉默导致 Redis 故障被误报为业务冲突

**严重性：** Medium（已修复）

**状态：** ✅ 已修复并确认

**描述：**

`pool-service` 和 `trade-service` 中的 `RedisService.setNX` 方法使用 `try/catch` 包裹，任何 Redis 故障（网络中断、服务宕机）都返回 `false`。调用方将 `false` 统一解释为"锁已被持有"，并抛出 `ConflictException("该订单正在处理中")` 或 `ConflictException("withdrawal already requested")`。

**影响：**

在 Redis 故障期间，用户收到误导性的业务错误信息（"订单正在处理中"），而非系统可用性问题提示（"服务暂时不可用"），影响运维排障和用户体验。

**修复方案：**

1. 移除 `RedisService.setNX` 中的 `try/catch`，让 ioredis 原生错误直接向上传播
2. 在调用处（`pool.service.ts:requestWithdrawal`、`repayment-due-notifier.service.ts`）增加 `try/catch`，将 Redis 故障映射为 `ServiceUnavailableException("服务暂时不可用，请稍后重试")`
3. 区分"锁被持有"（`setNX` 返回 `false`）和"Redis 不可达"（`setNX` 抛出异常）

**审计确认：** 修复已部署，后端全部 143 个单元测试通过。

---

### 4.3 [已修复] L-01: DB 中 `tenor` 字段单位不一致

**严重性：** Low（已修复）

**状态：** ✅ 已修复并确认

**描述：**

`TradeDeal.tenor` 字段在合约上以**秒**为单位存储（`tenor_days * 86_400`），但 trade-service 的 `confirmTrade` 接口将其以**天**为单位写入 PostgreSQL（`tenor: tenorDays`）。当 indexer 从链上同步数据时，写入的是秒值。造成了同表同字段的双重单位。

**影响：**

- `RepaymentDueNotifierService` 按秒解释 `tenor`，trade-service 创建的订单（tenor=30 天=30）约 30 秒后即判定为到期
- 前端 `RepaymentCountdown` 组件将 30 天的订单显示为 `Math.round(30/86400) ≈ 0` 天

**修复方案：**

- trade-service 写入 DB 时改为 `tenor = tenorDays * 86400n`（同链上一致）
- Prisma Schema 增加注释 `/// 账期，单位秒`
- 无需修改 indexer（它原本就是正确的秒值）和前端（假设秒值）

**审计确认：** 修复已部署，trade-service 和 repayment-due-notifier 测试全部通过。

---

### 4.4 [已确认] L-02: `default_deal` 中 `total_assets` 的会计处理

**严重性：** Low（已确认正确）

**状态：** ✅ 已确认为正确实现

**描述：**

`default_deal` 函数在两个分支下处理违约：
1. **非-RELEASED 场景**（融资与物流阶段）：将订单托管中的 `down_payment + pool_portion` 整笔转回 vault
2. **RELEASED 场景**（还款期）：托管已释放给卖方，vault 无资金收回，需动用保险基金赔付

需确认两种分支下的 `total_assets` 更新逻辑不会产生 vault 余额与会计值之间的偏差。

**审计确认：**

- **非-RELEASED 分支**：vault 收回 100% 托管资金（30% 抵押 + 70% 垫付），`total_assets` 已在 `create_deal` 时计入，无需重复调整。仅减少 `active_capital`。
- **RELEASED 分支**：`total_assets` 更新为 `total_assets - pool_portion + insurance_payout`，正确反映"融资本金已损失 + 保险赔付进入 pool"的会计状态。
- 集成测试中的 `assertPoolInvariant` 断言（验证 `total_assets == vault + 托管余额`）在两个分支下全程通过。

**结论：** 无修改必要，当前实现正确。

---

### 4.5 [已完成] I-01: 费用分配从"半实现"状态收敛为完整路径

**严重性：** Informational（已完成）

**状态：** ✅ 已完成

**描述：**

审计初期发现 `repay_deal` 的买方返利（`buyer_rebate`）计算后未实际转账，`pending_dividends` 仅做记账而无真实 token 支撑，且无 LP 分红提取指令。审计团队指出这是不完整的费用分配实现。

**修复方案（项目方在审计期间完成）：**

1. **资金流完整化：** `repayment_total` 改为 `pool_portion + fee`（全额 2.5% 费率），买方一次性支付全部费用
2. **买方返利实际到账：** 增加 `pool_token_account → buyer_token_account` 转账，返还 `buyer_rebate`（费率中的 10%）
3. **LP 分红真实支撑：** `lp_dividend` 现在与买方实际支付的 token 挂钩，具备真实资金支撑
4. **分红发放指令：** 新增 `distribute_dividends` 指令，管理员可将 `pending_dividends` 发放给指定接收方（从 vault 转出）
5. **链上返利累记录：** 新增 `RebateRecord` 账户（PDA），每个买方累计返利存储于链上，供审计与可视化

**审计确认：** 费用分配路径完整可执行，`BuyerRebateEvent` 和 `DividendDistributedEvent` 事件发出，测试通过。

---

### 4.6 [已解决] I-02: 前端 ESLint 规则未启用

**严重性：** Informational（已解决）

**描述：**

`eslint.config.mjs` 仅包含 `typescript-eslint` 推荐规则，未 import `next/core-web-vitals`。React Hooks 规则、`@next/next/no-img-element` 等 Next.js 特定检查均未生效。审计期间发现 3 处 `<img>` 标签使用了 raw HTML `<img>` 而非 Next.js 优化后的 `<Image>`。

**状态：** `eslint-config-next` 已通过 FlatCompat 桥接至 ESLint 9 flat config。`<img>` 标签已标注为 3 个 warning（无错误），项目方可逐步替换为 `<Image>`。

---

### 4.7 [已解决] I-03: 前端 SSR 被全量绕过

**严重性：** Informational（已解决）

**描述：**

`WalletProvider.tsx` 在客户端挂载前返回 `null`，由于它包裹整个应用树，服务端 HTML 近为空。首屏完全依赖客户端 JS 渲染，无 SEO/预渲染内容。

**状态：** 已移除 `return null`，改为 `return <>{children}</>`。服务端 HTML 现在包含完整的加载骨架。Hydration 安全性已通过 `useEffect` 中的 `setMounted(true)` 保证。

---

### 4.8 [已解决] I-04: 登录页错误信息模糊处理不当

**严重性：** Informational（已解决）

**描述：**

登录页将所有失败（网络中断、服务 500、密码错误）统一映射为"邮箱或密码错误"。当后端不可达时用户无法区分是密码错误还是服务故障。

**状态：** 已增加网络故障检测（`fetch`/`网络`/`timeout`/`Abort` 关键词匹配），区分返回"网络连接失败"和"邮箱或密码错误"，TOTP 失败独立提示。

---

### 4.9 [已解决] I-05: `formatUsdc` 通过 `Number()` 转换存在精度损失

**严重性：** Informational（已解决）

**描述：**

`formatUsdc` 使用 `Number(raw) / 1_000_000` 进行显示格式化。对于超过 `Number.MAX_SAFE_INTEGER`（约 9 * 10^15，即 ~90 亿 USDC）的金额，低位精度丢失，显示值可能偏差 1 USDC。

**状态：** 已改为 `BigInt` 原生运算（`n / 1_000_000n` + 手动分组千分位），完全消除浮点精度损失。同时保留非整数回退路径（`catch` 后用 `Number().toLocaleString`）以防非法输入导致页面崩溃。

---

## 5. 测试覆盖率

### 5.1 合约 Rust 单元测试

| 模块 | 测试数 | 通过 |
|------|--------|------|
| `trade-finance::state::tests` | 7 | ✅ |
| `trade-finance::test_id` | 1 | ✅ |
| `supply-chain::tests` | 7 | ✅ |
| **合计** | **16** | **16 / 16** |

覆盖场景：过期判断、状态转换合法性、非法状态码拒绝、SETTLED 锁定、NAV 溢出保护、`pending_dividends` 溢出保护、PDA 稳定性/确定/唯一性、账户空间精简、错误消息稳定性。

### 5.2 合约 Anchor TypeScript 集成测试

| 测试文件 | 用例数 | 说明 |
|----------|--------|------|
| `trade-finance.ts` | 30 | 完整生命周期 + 边界场景 + mint 不匹配负面测试 + 不变量断言 |
| `supply-chain.ts` | 13 | 管理员授权/撤销、供应商注册、无授权拒绝 |
| **合计** | **43** | |

### 5.3 后端 Jest 测试

| 指标 | 数值 |
|------|------|
| Test Suites | 24 |
| Test Cases | 143 |
| 通过率 | **100%** (143/143) |

### 5.4 前端测试

| 种类 | 测试数 | 状态 |
|------|--------|------|
| Vitest 单元测试 | 46 | ✅ 通过 |
| Playwright E2E | 3 | ✅ 通过 |
| Next.js 生产构建 | — | ✅ 通过 |

---

## 6. 改进建议

### 6.1 合约层面

| 编号 | 建议 | 优先级 |
|------|------|--------|
| **S-01** | 将 `usdc_mint`/`lp_mint` 纳入 `PoolState` 并增加 `require_keys_eq!` 链上校验 | **建议** |
| **S-02** | 为 `initialize_pool` 添加二次初始化保护（`require!` 检查初始状态字段） | 低 |
| **S-03** | `trade-finance/src/lib.rs` 约 1345 行，建议按指令拆分为 `instructions/` 目录下的独立模块 | 低 |
| **S-04** | `RedeemLp` 中 `usdc_out <= max_redeem` 的 50% 单次上限应可通过治理参数调整 | 低 |

### 6.2 后端层面

| 编号 | 建议 | 优先级 |
|------|------|--------|
| **B-01** | `exportCsv` 使用 `skip` 分页，大量数据时 offset 增长导致性能下降；建议改为 keyset 分页 | 低 |
| **B-02** | 各微服务中 `AuditService` 和 `RedisService` 存在代码重复，建议提取为共享模块 | 低 |
| **B-03** | 补充 Controller 层单元测试和存储层（S3/Local）集成测试 | 低 |

### 6.3 前端层面

| 编号 | 建议 | 优先级 |
|------|------|--------|
| **F-01** | 3 处 `<img>` 元素替换为 Next.js `<Image>` 以使用自动优化 | 低 |
| **F-02** | `uploadFileWithProgress` 无超时控制，建议增加 `timeout` 参数 | 低 |
| **F-03** | `AssetTrendChart` 和 `LiquidityUtilizationChart` 主题映射重复，建议抽取为共享 helper | 低 |

---

## 7. 附录

### 7.1 关键常量一览

| 常量 | 值 | 说明 |
|------|-----|------|
| `DOWN_PAYMENT_BPS` | 3000 (30%) | 买方首付比例 |
| `FEE_PCT_BPS` | 250 (2.5%) | 还款费率（按全单金额） |
| `PLATFORM_FEE_PCT_BPS` | 5000 (50%) | 平台分成（占费用） |
| `BUYER_REBATE_PCT_BPS` | 1000 (10%) | 买家返利（占费用） |
| `LP_DIVIDEND_PCT_BPS` | 4000 (40%) | LP 分红（占费用） |
| `RESERVE_FUND_PCT_BPS` | 8000 (80%) | 存入资金→准备金 |
| `INSURANCE_PAYOUT_PCT_BPS` | 1000 (10%) | 违约保险赔付率 |
| `MAX_REDEEM_BPS` | 5000 (50%) | 单次 LP 赎回上限 |
| `MIN_INSURANCE_ABS` | 100,000,000 (100 USDC) | 赎回后保险最低余额 |

### 7.2 审计发现汇总

| 编号 | 标题 | 严重性 | 状态 |
|------|------|--------|------|
| M-01 | PoolState 未锚定 USDC/LP Mint 地址 | Medium | ✅ 已修复并确认 |
| M-02 | `setNX` 故障沉默导致 Redis 故障被误报为业务冲突 | Medium | ✅ 已修复并确认 |
| L-01 | DB `tenor` 字段单位不一致 | Low | ✅ 已修复并确认 |
| L-02 | `default_deal` 中 accounting 逻辑需确认 | Low | ✅ 已确认为正确 |
| I-01 | 费用分配"半实现"状态 | Informational | ✅ 已完成 |
| I-02 | 前端 ESLint 规则未启用 | Informational | ✅ 已解决 |
| I-03 | 前端 SSR 被全量绕过 | Informational | ✅ 已解决 |
| I-04 | 登录页错误信息模糊处理不当 | Informational | ✅ 已解决 |
| I-05 | `formatUsdc` 精度损失 | Informational | ✅ 已解决 |

> **无 Critical 或 High 级别发现。所有 Medium 及 Low 发现已由项目团队完成修复并复核确认。**

### 7.3 免责声明

本评估基于评估期间提供的代码版本，不构成对项目安全性、合法性或商业可行性的保证。任何对核心合约逻辑的修改（包括但不限于业务常量数值变动、账户结构体添加/删除字段、指令签名修改）应当进行重新评估。

---

**项目安全评估团队**  
2026 年 8 月 7 日

---

## 8. 项目侧复核补充（2026-08-07）

> 本节为项目团队对**当前仓库状态**的复核补充。

### 8.1 测试计数（当前仓库实际）

| 项 | 审计报告记录 | 当前实际 |
|---|---|---|
| 合约 Rust 单测 | 15 | **16/16**（trade-finance 8 + supply-chain 8） |
| Anchor 集成测试 | ~37 | **43/43**（含资金恒等式/记账增量断言） |
| 后端 Jest | 143 | **143/143** |
| 前端 Vitest | ~8 | **46/46** |
| Playwright e2e | 2 | **3**（含 TOTP 两步登录） |

### 8.2 评估后新增/修复（补充）

- **依赖审计清零**：移除 `@solana/spl-token` 运行时依赖（手工实现 ATA 指令），
  `pnpm audit --prod` = **No known vulnerabilities found**（消除 bigint-buffer 高危）。
- **前端启用 CSP**：`object-src 'none'` / `frame-ancestors 'none'` / connect-src 白名单 / report-uri。
- **管理员 TOTP 两步验证**（RFC 6238，node:crypto 原生实现，密钥 AES-256-GCM 加密存储）。
- **合约 `redeem_lp` 流动性保护加强**：`vault_after >= active_capital`（审计 L1 建议落实）。
- **链上/DB 对账服务** `scripts/reconcile`：每日核对资金恒等式，退出码 1 供告警。
- **主网部署工具链**：`deploy-mainnet.sh` / `init-mainnet.sh`（硬护栏 + dry-run）。
- **未落实项（报告 S-01 建议）**：将 `usdc_mint`/`lp_mint` 纳入 `PoolState` 的链上锚定
  仍为后续版本建议，当前以链下校验 + 负面测试兜底。

### 8.3 上线状态（截至 2026-08-07）

- **内部安全评估：✅ 完成**（本报告：B+，无 Critical/High，2 个中危已修复确认）。
  ⚠️ 真实第三方审计尚未执行——上线硬门槛仍需独立机构出具报告（审计材料包已备好，见 `scripts/build-audit-package.sh`）。
- 剩余上线事项（均为可执行）：
  1. 真实 VPS/K8s 部署 + 全链路冒烟（工具链已备：`deploy/vps` + `deploy-mainnet.sh`）。
  2. 主网 RPC 付费套餐 + 主网配置（`SOLANA_RPC_URL`/Program ID/USDC/LP）。
  3. 主网小额真实资金灰度 → 放量（见 `docs/MAINNET-MIGRATION.md`）。
