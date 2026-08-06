# 合约不变式清单

以下不变式必须在任何一次合约升级后重新验证。

## 资金池账本

- `total_assets == pool vault USDC + 全部订单托管 USDC`
- `active_capital == Σ 已放款订单的 pool_portion`
- `pending_dividends + Σ 已发放分红 == Σ 还款产生的 LP 分红`
- 任何时刻 `insurance_fund >= 0` 且 `reserve_fund >= 0`

## 订单生命周期

- `PENDING -> FUNDED -> IN_TRANSIT -> CUSTOMS_CLEAR -> DELIVERED -> REPAYING -> SETTLED`
- `FUNDED..=DELIVERED | REPAYING` 可进入 `DEFAULTED`；`REPAYING` 违约需已到期。
- `SETTLED` 后不可再变更；`DEFAULTED` 后不可再推进。

## 资金安全

- 托管释放前违约：整笔托管（首付 + 垫付）回到 pool vault，无资金卡死。
- 托管释放后违约：保险赔付按 `pool_portion * 10%` 记账，不做空转账。
- 赎回后 `insurance_fund >= MIN_INSURANCE_ABS`。
- 分红发放 `amount <= pending_dividends`，且 `pending_dividends` 有 vault 现金支撑。

## Rust 测试锚点

- `state::tests::*`：状态机、过期、溢出、分红累加、NAV。
- `Anchor 集成测试`：全生命周期 + 边界（重复初始化、重复存证、超额分红等）。
