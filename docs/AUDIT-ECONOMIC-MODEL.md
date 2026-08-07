# 经济模型说明（供审计机构参考）

本文件从合约代码提取，作为第三方审计时的经济模型基线。所有比例均为 BPS（1/10000）。

## 1. 订单结构

| 参数 | 值 | 说明 |
|---|---|---|
| `DOWN_PAYMENT_BPS` | 3000（30%） | 买方下单时首付进托管 |
| 垫付比例 | 7000 bps（70%） | 资金池垫付部分，`active_capital` 记为应收 |
| 账期 `tenor` | 30/60/90/120 天 | 单位秒存链上 |
| 费用 `FEE_PCT_BPS` | 250（2.5%） | 按订单金额收，买方还款时支付 |

## 2. 费用分配（`repay_deal`，占费用金额的比例）

| 接收方 | 比例 | 说明 |
|---|---|---|
| 平台分成 | 50%（`PLATFORM_FEE_PCT_BPS=5000`） | 转平台钱包 |
| LP 分红 | 40%（`LP_DIVIDEND_PCT_BPS=4000`） | 留在 vault，记 `pending_dividends` |
| 买方返利 | 10%（`BUYER_REBATE_PCT_BPS=1000`） | 退回买方，记 `rebate` 账本 |

> 审计重点：LP 分红必须有对应 USDC 进账（H1 修复后为全额费用进池再分配），
> `pending_dividends` 任何时刻都应能被 vault 现金覆盖。

## 3. 资金池结构与不变式

- `total_assets = vault + Σ 订单托管余额 + active_capital`（全局不变式，DFR M-01 整改后成立；
  `fund_deal` 不再重复计入 `active_capital`，垫付计入 `escrow_funded`）
- `reserve_fund` 占 vault 80%（`RESERVE_FUND_PCT_BPS=8000`）
- `insurance_fund` 占 vault 20%（2000 bps），最低绝对值
  `MIN_INSURANCE_ABS=100_000_000`（100 USDC）
- `active_capital` 单列为在途应收（不并入 vault）

## 4. 违约（`default_deal`）

- FUNDED/DELIVERED 阶段违约：托管整笔（30% 首付 + 70% 垫付）一次性回池，
  `active_capital` 清零，`total_assets` 不变（H2 修复）
- 违约事件触发风控 Webhook（`RISK_WEBHOOK_URL`）

## 5. LP 赎回（`redeem_lp`）

- 单次上限 `MAX_REDEEM_BPS=5000`（50% 当期 vault）
- 流动性保护：赎回后 `vault_after >= active_capital`（审计 L1 已加强）
- 保险池不得低于 `MIN_INSURANCE_ABS`
- LP 代币由链下 mint authority 铸币（审计 L2：上线前必须交多签/治理方）

## 6. 集中度限制

- 集中度上限 100 bps（1%）：单订单垫付 ≤ vault 的 1%

## 7. 保险赔付

- `INSURANCE_PAYOUT_PCT_BPS=1000`（保险赔付占 vault 10% 上限）

> 注：垫付比例(70%)、保险占比(20%)、集中度上限(1%) 在合约中已以内联数值实现
> （原命名常量 `FUNDING_PCT_BPS` / `INSURANCE_FUND_PCT_BPS` / `MAX_CONCENTRATION_BPS`
> 已随 2026-08-06 重构移除），数值与本文档一致。

## 8. 供应链注册（`supply-chain`）

- 管理员（Registry）可授权/撤销供应商
- 仅管理员或已授权供应商可注册商品（`sku` 长度 ≤ 64 硬校验）
