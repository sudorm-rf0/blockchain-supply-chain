# Trade-Finance 合约审计报告

- 日期：2026-08-06
- 范围：`programs/trade-finance`、`programs/supply-chain`
- 方法：逐指令通读 + 账本不变式推演 + Rust 单测 + Anchor 集成测试

## 结论

发现并修复 4 个会导致资金或账本错误的逻辑问题，1 个流动性保护偏弱问题
保留为设计建议。修复后 38 个 Anchor 集成用例与两套 Rust 单测全部通过。

## 已修复（High）

### H1 还款未收足费用，LP 分红成为无资金支撑的负债

位置：`repay_deal`

原逻辑只要求买方转入 `本金 70% + 平台分成(费用 50%)`，但 `pending_dividends`
却增加 `费用 40%`。LP 分红没有对应的 USDC 进账，后续分配时资金池会凭空
少钱。

修复：买方转入 `本金 70% + 全额费用 2.5%` 到资金池 vault，再由资金池分别
支付平台分成、退回买方返利 10%，LP 分红 40% 留在 vault 内并以
`pending_dividends` 记账。`total_assets` 只增加 `lp_dividend`，账本与现金一致。

### H2 违约后 70% 垫付款永久卡死在订单托管

位置：`default_deal`（FUNDED/DELIVERED 阶段违约）

原逻辑只把 30% 抵押金转回资金池，70% 垫付款仍留在 `deal_token_account`，
而订单已置为 DEFAULTED，没有任何指令能把这笔钱取出。

修复：托管尚未释放时，把整笔托管（30% 抵押金 + 70% 垫付款）一次性转回资金池，
`active_capital` 清零，`total_assets` 不变（托管资产转为 vault 现金）。
该路径不再需要保险赔付。

### H3 托管释放后未扣减已支付给卖方的抵押金

位置：`release_to_seller`

原逻辑把 `amount`（100%）从托管转给卖方后，`total_assets` 仍保留 30% 抵押金，
造成账面虚增；后续默认/赎回计算会基于错误的总资产。

修复：`pool_state` 改为 `mut`，释放时 `total_assets -= down_payment`，
70% 垫付款继续以 `active_capital`（买方应收）记账。

### H4 创建订单时把尚未放款的 100% 计入总资产

位置：`create_deal`

原逻辑 `total_assets += amount`，但此刻只有 30% 首付进入托管，70% 尚未投放，
导致 `total_assets` 与 vault + 托管 的实物不变式不一致。

修复：`create_deal` 只增加 `down_payment`；`fund_deal` 不再从 `total_assets`
扣减（vault 到托管属于内部划转）。修复后不变式恒成立：
`total_assets = vault + 托管余额`，`active_capital` 单列为应收。

## 加固（Medium/Low）

### M1 SKU 长度未显式校验

`supply-chain register_product` 依赖 `#[max_len(64)]` 账户空间，但输入未显式
检查。新增 `SkuTooLong` 错误，`sku.len() <= 64` 硬校验。

### M2 新增链上能力：分红分配与返利子账户

- 新增 `distribute_dividends`：管理员把 `pending_dividends` 从资金池 vault
  实际发放给指定接收方，避免“只记账、永远不分”。
- 新增 `RebateRecord` 账户：`repay_deal` 时把买方返利累计写入链上，
  并发出 `BuyerRebateEvent`，形成可审计的“买家子账户”。

### L1 LP 赎回的流动性保护偏弱

`redeem_lp` 用 `active_capital <= total_after` 做保护，而 `total_after` 包含
托管中的抵押金，允许把 vault 抽到低于在途应收。不会导致资不抵债（NAV 仍为
正），但会降低流动性。建议后续按业务需求评估是否改为
`vault_after >= active_capital`。

### L2 LP 代币铸币权在链下

合约只销毁 LP 代币，铸币由外部 mint authority 完成。上线前必须把
`lp_mint` 的 mint authority 交给可审计的治理方/多签。

## 验证

- `cargo test`：trade-finance 8 个、supply-chain 8 个全部通过。
- `anchor test`：39 个集成用例全部通过（含边界：重复放款、重复还款、
  跳状态、超额集中度、错误 mint、供应商权限、分红发放、返利记账等）。
