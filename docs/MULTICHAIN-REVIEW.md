# MultiChain 参考代码审查结论（留档）

审查对象：`/Users/fangfang/Documents/dfrchain/multichain-master/`
（MultiChain，Coin Sciences 开源的 C++ 私有链平台，Bitcoin Core 分支，2014–2019）。

结论日期：2026-08-04。本文档用于避免后续重复分析。

## 结论

**不引入 MultiChain 的代码**。原因：

- **技术栈与定位不匹配**：MultiChain 是"自己跑一条私有链"的平台（C++ / Bitcoin
  Core 分支），而本项目是构建在 Solana/Anchor 之上的供应链金融应用
  （Rust 合约 + NestJS + Next.js）。两者处于不同层次，无可直接复用/迁移的代码。
- **维护状态**：快照落盘于 2022-07，代码版权止于 2019，官方多年无实质更新；
  内嵌 V8（JS 过滤器）与依赖链老旧。
- **许可**：GPLv3。
- 移植它等于放弃现有 Solana 生态（合约、微服务、前端、CI、文档、内部审计）。

## 可参考的设计点（思路层面）

| MultiChain 特性 | 本项目对应/落实 |
| --- | --- |
| **权限模型**：地址级 + 实体级、可撤销（connect/send/receive/issue/write/admin…） | ✅ 已落实为 `supply-chain` 权限化注册：`Registry`（唯一管理员）授权/撤销 `Supplier`，仅管理员或已授权供应商可 `register_product` |
| **数据流 streams**：链上追加式存证 + 独立写权限 | 已由 `attest_document`（SHA-256 + URI 上链）+ indexer 覆盖，无需引入 |
| **原生资产 + 发行/转账限制** | SPL token（USDC/LP）+ Anchor 校验更现代，不需要 |
| **智能过滤器**（V8 JS 沙箱验证交易） | 私有链无智能合约的妥协方案；Solana 用 program 即策略，不需要 |

## 已落实的落地项

- `supply-chain` 合约：`initialize_registry` / `authorize_supplier` /
  `revoke_supplier` / `register_product` + `Registry`/`Supplier`/`Product` 账户
  （commit `98aaa59`）
- 主后端供应链管理 API + 前端「供应链管理」页（commit `7a218a8`）
- `scripts/init-supply-chain.mjs` 幂等初始化脚本（commit `dc5ff11`）
- smoke-e2e 覆盖权限化注册（commit `05deb3f`）；Rust 单测（commit `83f74b9`）

## 后续（如需）

- devnet/主网部署后执行 `scripts/init-supply-chain.mjs <供应商公钥...>`
- 如业务需要"供应商自行注册商品"，可在现有权限模型上为供应商钱包开放
  `register_product` 调用（当前仅管理员在管理端注册）。
