# 合约审计材料包

供第三方审计方使用。以下内容在仓库内均可直接取得。

## 交付物

- 合约源码：`packages/contracts/programs/trade-finance/src/`、
  `packages/contracts/programs/supply-chain/src/`
- IDL：`packages/contracts/target/idl/trade_finance.json`、
  `packages/contracts/target/idl/supply_chain.json`
- 测试：`packages/contracts/tests/trade-finance.ts`（49 个用例）、
  `packages/contracts/tests/supply-chain.ts`（17 个用例）、
  `packages/contracts/tests/c1-program-data-regression.ts`（2 个用例，C-1 伪造 program_data 拒绝回归）；另有
  `cargo test` Rust 单测（trade-finance 15、supply-chain 9，含 1 proptest）
- 部署信息：Program ID 见 `Anchor.toml`；localnet 部署见
  `scripts/deploy-devnet.sh` 与 `scripts/init-localnet.mjs`
- 合约状态机：`PENDING → FUNDED → IN_TRANSIT → CUSTOMS_CLEAR → DELIVERED →
  REPAYING → SETTLED / DEFAULTED`

## 建议审计重点

1. `create_deal` 首付锁定、1% 集中度上限与 token CPI。
2. `fund_deal` / `release_to_seller` / `repay_deal` 的资金流向与费用分配
   （平台 50% / 返利 10% / LP 40%）。
3. `default_deal` 抵押清算与保险基金赔付。
4. `calculate_nav` 与 LP 供应量边界（`ZeroLpSupply`）。
5. 所有 `require!` 与 checked 算术是否覆盖状态机非法跳转。
6. PDA seeds 与 bump 使用、`Option<Account>` 处理。

## 审计方需额外提供

- 审计报告（High/Critical 必须清零后部署主网）。
- 复测说明与建议修复补丁。

## 已知边界（审计时应一并告知）

- `redeem_lp` 已实现：LP 按 NAV 赎回，受单次 50% 上限与保险池最低余额保护；
  管理端 7 天提款审批闭环仍然保留。
- `supply-chain` program 为权限化注册：`Registry`（唯一管理员）可授权/撤销
  供应商，仅管理员或已授权供应商可注册商品（Product PDA 按 owner + SKU 哈希
  派生）；`Option<Account<Supplier>>` 的 None 占位使用程序 ID（Anchor 约定）。
