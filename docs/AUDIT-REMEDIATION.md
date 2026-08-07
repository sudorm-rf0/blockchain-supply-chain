# 审计整改记录（2026-08-07）

本表汇总内部安全评估（`AUDIT-REPORT.md` / `CERTIK-REPORT.md`）及早期专项审计
（`CONTRACT-AUDIT.md`）中的全部发现与整改状态，供真实第三方审计时核对。

## 〇、独立复测整改（2026-08-08，对应 SECURITY-AUDIT-REPORT 独立审查）

| 编号 | 问题 | 整改 |
|---|---|---|
| **C-1（Critical）** | `initialize_pool`/`initialize_registry` 的 `program_data` 账户未绑定地址 → 攻击者可传入自己程序的 ProgramData 伪造 upgrade authority，抢跑初始化夺取管理员 | ✅ **修复**：两程序初始化前强制 `program_data.key() == 本程序 ProgramData PDA`（`BPF_LOADER_UPGRADEABLE` + `find_program_address`）；新增 Rust 单测锚定 PDA；anchor 66/66 通过 |
| **H-3（High）** | `deposit_pool` 以实时金库余额定价 → 直接捐赠抬高份额定价基准，首存者+捐赠可抽干后续存款人 | ✅ **修复**：`PoolState` 新增权威记账 `tracked_vault`（仅由程序出入金更新），全部 8 个资金指令同步维护；deposit/redeem 等入口校验实时余额 == tracked_vault（VaultMismatch 拒绝外部捐赠）；新增 H-3 捐赠回归测试 |
| **L-1（Low）** | `repay_deal` 强制 `fee > 0` → 微单（fee 向下取整为 0）无法结清（DoS） | ✅ **修复**：允许 fee=0 纯还本路径 |
| **M-1（审计误判，未改）** | 报告称未释放违约 `total_assets` 少计 `pool_portion` | ⚠️ 复核：M-01 已把放款记入 `escrow_funded`（非 active_capital），未释放违约减 `escrow_funded` 即正确；`total_assets` 不变满足 INV-1，报告结论基于旧代码，**无需修改**（已用记账增量测试验证） |
| **H-2（High）** | `test-deployer` 特性若被编译进主网构建 → 硬编码 DEPLOYER 成为初始化后门 | ✅ **脚本防护**：precheck 校验 `test-deployer` 未设为默认特性、主网部署命令不携带该特性（回归即 FAIL） |
| **M-3（Medium）** | 先冻结 upgrade authority 后初始化 → 生产路径拒绝初始化（部署变砖） | ✅ **脚本防护**：deploy-mainnet.sh 冻结前校验资金池/注册中心 PDA 已在链上，否则中止 |

## 一、本次整改完成（2026-08-07 批次）

| 编号 | 问题 | 整改 |
|---|---|---|
| **S-01 / M-01 / CK-001** | PoolState 未链上锚定 USDC/LP Mint | ✅ **链上锚定**：`PoolState` 新增 `usdc_mint`/`lp_mint` 字段并写入；全部资金指令（create/fund/release/repay/dividends/deposit/redeem/default）对 mint 字段加 `require_keys_eq!` 约束；indexer 布局/偏移同步（size 121→185）；初始化脚本/测试同步；Anchor 测试 **62/62**（含 mint 不匹配负面用例） |
| **S-02** | `initialize_pool` 二次初始化 | ✅ 已由 Anchor `init` 约束覆盖（re-init 拒绝测试通过） |
| **B-01** | `exportCsv` offset 分页性能退化 | ✅ 改 keyset 分页（唯一主键 `id` 游标，`orderBy createdAt,id`） |
| **F-01 / CK-008** | 3 处 `<img>` 未用 Next.js Image | ✅ 改用 `next/image`（`unoptimized`，本地 blob 预览合规） |
| **F-02 / CK-007** | 上传无超时控制 | ✅ XHR 增加 `timeout`（默认 120s，`NEXT_PUBLIC_UPLOAD_TIMEOUT_MS` 可配） |
| **F-03** | 图表主题映射重复 | ✅ 抽取共享 `useChartTheme` hook |
| **B-03** | Controller 层测试缺失 | ✅ 新增 `audit.controller.spec.ts`（list 参数钳制、exportCsv 流、limit 上限） |
| **CK-004** | Prisma BigInt 序列化限制 | ✅ 已在 Prisma 6.19.3 + 48 位订单 ID 约束下缓解（现状复核） |
| **B-02** | AuditService/RedisService 重复 | ✅ 已抽到 `@supply-chain/common`（HealthController/AuditService/RedisService） |

## 二、此前已修复（历史审计批次）

| 编号 | 问题 | 状态 |
|---|---|---|
| H1-H4（CONTRACT-AUDIT） | 还款费用未收足/LP 分红无支撑、违约垫付卡死托管、释放未扣抵押金、create 虚增总资产 | ✅ 已修复并有 49→62 集成测试守护 |
| L1 | `redeem_lp` 流动性保护偏弱 | ✅ `vault_after >= active_capital` |
| M-02 / CK-002 | `setNX` 故障沉默误报业务冲突 | ✅ 已修复（降级 503） |
| L-01 / CK-003 | `tenor` 字段单位不一致 | ✅ 全链路统一秒 |
| 依赖审计 | 39 → 14 high → 1 high（bigint-buffer）→ 0 | ✅ `@solana/spl-token` 运行时依赖移除，`pnpm audit --prod` = 0 |
| CSP | 前端未启用 CSP | ✅ nonce 中间件 + 头下发 |

## 三、延期项（附理由，上线前需按治理决定）

| 编号 | 项 | 理由 |
|---|---|---|
| **S-03** | 合约按指令拆分目录 | 纯重构、低价值；真实审计通过后如无新改动可保持现状 |
| **S-04** | `RedeemLp` 50% 上限改治理参数 | v1 用常量上限可接受；改为池参数需额外治理与复测，建议二期 |
| **CK-005** | K8s Native Secrets → Sealed Secrets/External Secrets | 需真实集群 + 控制器安装；**上线时启用**：`kubectl create secret` 的 Native Secret 可被集群管理员读取，生产建议接入 Sealed Secrets 或云 KMS（方案见 DEPLOYMENT.md 安全章节） |
| **CK-006** | 生产环境真实集群验证 | 需云资源；审计通过后按 `deploy/vps` 或 K8s 执行 |
| **LP mint authority 链下铸币** | 铸币权交多签/治理方 | 主网部署前必须完成（非代码项） |
