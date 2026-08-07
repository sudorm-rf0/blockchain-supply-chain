# 已知风险与设计决策（供审计机构参考）

本文档列出审计前已知的风险点与设计决策，帮助审计方聚焦高价值路径。

## 已修复（内部审计 2026-08-06，建议第三方复检）

| # | 风险 | 修复 |
|---|---|---|
| H1 | 还款未收足费用，LP 分红成为无资金支撑的负债 | 全额费用进池后再分配，`pending_dividends` 有现金支撑 |
| H2 | 违约后 70% 垫付款永久卡死在托管 | 违约时托管整笔回池 |
| H3 | 托管释放后未扣减已支付给卖方的抵押金 | `release_to_seller` 扣减 `down_payment` |
| H4 | 创建订单时把未放款金额计入总资产 | `create_deal` 只增 `down_payment`，`fund_deal` 内部划转 |
| L1 | LP 赎回流动性保护偏弱 | `vault_after >= active_capital` |

## 已知风险（建议第三方重点复核）

1. **`DistributeDividends`（新指令）**：分红总额是否受 `pending_dividends` 硬约束；
   单人是否可重复领取；`recipient`/`recipient_token_account` 绑定是否可绕过。
2. **买方返利账本 `rebate`**：`init_if_needed` 的 payer/rent 是否可被恶意占用；
   返利累计与 `pending_dividends`/vault 的一致性。
3. **LP mint authority 在链下（L2）**：~~合约只销毁 LP 代币，铸币由外部 authority 完成，
   上线前必须交多签/治理方，否则存在增发风险~~ → **已修复（C-01）**：LP mint authority
   强制为 `pool_authority` PDA，铸币收归合约控制（存款时按 NAV 铸造），增发面收敛到合约校验内。
4. **`default_deal` 保险路径**：`INSURANCE_PAYOUT_PCT_BPS=1000` 的触发条件与限额；
   托管释放 vs 违约的时序竞争。
5. **u64 边界**：金额/费用/分红的所有 `checked_*` 运算；除法的取整方向（向下）是否造成
   系统性偏差。
6. **集中度限制（100 bps / 1%）**：极端池规模下是否可被绕过或过于宽松。
7. **`supply-chain` 权限模型**：Registry 管理员私钥泄露的影响面；供应商撤销后的存量商品。

## 设计决策（已知取舍）

- 平台分成/返利/分红比例（50/40/10）为业务参数，主网部署前需业务方确认。
- `active_capital` 单列应收，不要求 vault 全额覆盖（有集中度与赎回保护兜底）。
- 违约清算自动回池，无人工仲裁环节——业务上接受"程序化违约"。
- 索引器（indexer）为链下旁路，DB 状态以链上为准；对账脚本 `scripts/reconcile.mjs`
  每日核对链上/DB 一致性。

## DFR 审计整改（2026-08-07，依据 DFR-SC-2026-0143）

以下 DFR 审计发现已在合约层完成整改（代码已合入 main，55 项 Anchor 集成测试 + 15 项 Rust 单测全部通过）：

| 编号 | 标题 | 整改措施 |
|------|------|----------|
| C-01 | LP 铸币权链下 | `deposit_pool` 链上按 NAV 铸造 LP（首笔 1 USDC=1 LP）；`initialize_pool` 校验 mint_authority=pool_authority、无 freeze、decimals 匹配 |
| H-01 | 初始化抢跑 | `initialize_pool`/`initialize_registry` 绑定部署方（DEPLOYER 白名单 或 upgrade authority） |
| H-02 | 分红定向转移 | `distribute_dividends` 增加 DividendClaim 领取台账（可审计），事件携带累计领取额 |
| H-03 | admin 集中 | `transfer_admin` 改为两步轮换（propose_admin + accept_admin + 锁定期参数） |
| M-01 | 不变式失效 | `fund_deal` 不再重复计入 `active_capital`，新增 `escrow_funded` 字段；恒等式 `total_assets = vault + 托管 + active` 成立 |
| M-02 | 保险重复计入 | `default_deal` 已释放路径不再向 `total_assets` 虚增保险赔付 |
| M-03 | 现金与记账脱钩 | `fund_deal` 增加 `vault_after >= insurance_fund` 校验 |
| M-04 | NAV/赎回价不一致 | 新增 `redemption_price` 字段并分别披露；赎回事件携带两个价格 |
| M-05 | 赎回无窗口 | 新增 `redeem_window_epoch/used`，周期内累计上限 50% |
| M-06 | 存证未隔离 | `document` PDA 纳入 buyer 种子；`deal` 改为必选 |
| M-07 | 自融资闭环 | `create_deal` 增加 `seller != buyer`、`seller != default` 校验 |
| M-08 | 集中度基数 | 改为基于可用流动性（vault - insurance - pending） |
| M-09 | mint 不可迁移 | 新增 `set_lp_mint`（要求暂停 + 无在途 + 旧 supply=0 + 新 mint 属性校验） |
| M-10 | 除零 DoS | `redeem_lp` 增加 `total_before > 0` 校验 |
| M-11 | supply 不可轮换 | `supply-chain` 新增 `transfer_admin` |
| L-02 | 终态无 close | 新增 `close_deal`；`set_status` 对 DEFAULTED 同样终态锁定 |
| L-03 | 事件缺失 | `create_deal`/`deposit_pool`/`default_deal` 补事件 |
| L-06 | attest 不受暂停 | `attest_document` 增加暂停守卫 |
| L-08 | authorize 非幂等 | `authorize_supplier` 改为 `init_if_needed`（幂等） |
| I-02 | get_pool_info 缺字段 | 补齐 paused/usdc_mint/lp_mint/escrow_funded/redemption_price/窗口/待接受管理员 |
| I-05 | sku_seed 注释 | 修正为准确的技术说明 |

### H-04 进度（2026-08-07）

- 合约层已落地：`fee_apy_bps` 参数化（默认 670 = 6.7% APR）、分配比例可治理（`set_fee_params`）、
  `first_loss_reserve` 首损层（`deposit_first_loss`/`withdraw_first_loss`）、单笔费率上限
  `MAX_SINGLE_FEE_BPS`（5%P）、NAV 口径剔除首损、`repay_deal` 按日计息记账修正（dust 偏差）。
- 待业务方决策：目标违约率（默认按 2%）、首损池实际注资规模（建议在途 6%）、费率参数最终值
  （见 docs/H-04-费率重构方案.md）。

### 仍未整改（需业务/运营决策或后续版本）

- H-04 参数最终值（需业务与风控按真实违约数据确认）
- L-01（ATA 强制约束）、L-04（逾期罚息）、L-05（LP decimals 校验已做，见 C-01）、L-07（清盘路径）、L-09（商品撤销标记）
- I-01（lib.rs 模块拆分）、I-03（proptest/trident 模糊测试，需工具链）
- 多签部署（Squads）、时锁参数调优（`ADMIN_TRANSFER_DELAY_SECS` 上线前设为 >= 48h）

## DFR 复测（DFR-2026-0144）整改（2026-08-07）

DFR 复测确认首次审计 1 Critical + 4 High 已代码级修复，并识别 6 项新发现，整改如下：

| 编号 | 标题 | 严重性 | 整改 |
|------|------|--------|------|
| N-01 | NAV 与份额铸造/赎回用价不一致 | Medium | 铸造/赎回统一为纯现金权益基准（equity_base = vault - first_loss），消除套利；NAV 账面披露（redemption_price 分离） |
| N-02 | 管理员转移时锁为 0 | Medium | `pending_admin_delay_secs` 参数化，默认 172_800（48h），新增 `set_admin_delay` 治理；集成测试验证时锁生效 |
| N-03 | 单管理员无多签/角色分离 | Medium | 运营层：admin 可指向 Squads 多签 PDA（代码已支持），需上线部署 |
| N-04 | sku_seed 8 字节碰撞 | Low | 改用完整 SHA-256（32 字节）种子 |
| N-05 | DEPLOYER 硬编码测试钱包 | Medium | 初始化规则改为：upgrade authority 存在则必须匹配（冷钱包），仅 UA 冻结时回退 DEPLOYER |
| N-06 | 首损计入 LP 权益 | Medium | 铸造/赎回/redemption_price 全部基于 equity_base（剔除首损），首损不可被 LP 赎回 |

测试：Rust 22/22、Anchor 62/62、Jest 146/146、Vitest 48/48。

## DFR 第三轮复测（DFR-2026-0145）整改（2026-08-07）

| 编号 | 标题 | 严重性 | 整改 |
|------|------|--------|------|
| H-05 | set_admin_delay 时锁自废后门 | High | `set_admin_delay` 设硬下限 `MIN_ADMIN_DELAY_SECS=86400`，不得下调；初始时锁由 `initialize_pool` 注入（生产 48h） |
| M-12 | supply-chain 一步管理员转移 | Medium | `transfer_admin` 改为两步轮换（propose_registry_admin + accept_registry_admin）+ 锁定期字段 + set_registry_admin_delay |
| L-11 | 分红接收方自由指定 | Low | `distribute_dividends` 仅允许向 LP 持有者发放，且单次不超过其按 LP 占比应得份额 |

测试：Rust 22/22、Anchor 63/63。
