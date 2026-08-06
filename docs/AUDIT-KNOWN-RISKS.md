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
3. **LP mint authority 在链下（L2）**：合约只销毁 LP 代币，铸币由外部 authority 完成。
   上线前必须交多签/治理方，否则存在增发风险。
4. **`default_deal` 保险路径**：`INSURANCE_PAYOUT_PCT_BPS=1000` 的触发条件与限额；
   托管释放 vs 违约的时序竞争。
5. **u64 边界**：金额/费用/分红的所有 `checked_*` 运算；除法的取整方向（向下）是否造成
   系统性偏差。
6. **集中度限制 `MAX_CONCENTRATION_BPS=100`**：极端池规模下是否可被绕过或过于宽松。
7. **`supply-chain` 权限模型**：Registry 管理员私钥泄露的影响面；供应商撤销后的存量商品。

## 设计决策（已知取舍）

- 平台分成/返利/分红比例（50/40/10）为业务参数，主网部署前需业务方确认。
- `active_capital` 单列应收，不要求 vault 全额覆盖（有集中度与赎回保护兜底）。
- 违约清算自动回池，无人工仲裁环节——业务上接受"程序化违约"。
- 索引器（indexer）为链下旁路，DB 状态以链上为准；对账脚本 `scripts/reconcile.mjs`
  每日核对链上/DB 一致性。
