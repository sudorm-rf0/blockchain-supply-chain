# Trade-Finance 合约威胁模型

## 角色与信任边界

- `admin`：资金池管理员，可放款、推进物流、释放托管、判定违约、发放分红。
  是系统内最高权限角色；私钥泄露等于资金池被接管。
- `buyer`：订单买方，支付 30% 首付并在还款期支付本金与费用。
- `seller`：订单卖方，接收托管释放的 100% 货款。
- `lp`：LP 持有人，通过 deposit/redeem 参与资金池；分红由管理员发放。
- `platform_wallet`：平台费用收款钱包，由管理员在 initialize_pool 指定。

## 资产与流向

- 首付：buyer -> 订单托管（create_deal）。
- 垫付：pool vault -> 订单托管（fund_deal）。
- 释放：订单托管 -> seller（release_to_seller）。
- 还款：buyer -> pool vault（本金 + 全额费用），pool vault -> platform_wallet
  （平台分成）与 buyer（返利），LP 分红留在 vault。
- 违约：托管未释放时整笔回 pool vault；已释放时保险基金记账补偿。
- 赎回：LP 销毁 + pool vault -> LP 的 USDC。
- 分红：pool vault -> 指定接收方（distribute_dividends）。

## 关键不变式

1. `total_assets = vault 余额 + 订单托管余额`。
2. `active_capital` = 已放款应收，单列。
3. `pending_dividends` 始终有 vault 现金支撑。
4. 任何指令都不得把资金永久锁死在托管账户。

## 攻击面与缓解

- 越权调用：所有管理员指令校验 `pool_state.admin`；还款校验 `deal.buyer`。
- 状态机跳转：`validate_advance` 与各指令的 status require 收紧合法路径。
- 重复初始化：PDA + `init` 保证幂等失败。
- 算术溢出：金额计算全部 `checked_*`。
- 错误 mint/owner：TokenAccount 约束校验 owner 与 mint。
- CPI 安全：仅调用 SPL Token 的 transfer/burn，且使用 PDA signer seeds。
- 资金卡死：违约/释放路径已审计，托管余额要么转出要么继续有归属。

## 残余风险（需人工决策）

- `lp_mint` 铸币权在链下，上线前应交给多签/治理。
- `redeem_lp` 允许在有在途应收时抽干闲置现金（流动性风险，非资不抵债）。
- `bigint-buffer` 传递依赖无上游补丁，属于供应链残余风险。
