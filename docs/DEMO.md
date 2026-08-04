# Demo 演示手册

当前系统可以作为单机 Demo 完整演示：注册/登录、文件上传与链上存证、管理员审核、
订单创建/拨款/物流推进/释放/还款/结清、违约场景、资金池看板、LP 提款。

## 0. 静态演示页（无需启动后端）

仓库根目录的 `demo.html` 是自包含演示页，浏览器直接打开即可：

```bash
open demo.html
```

- 左侧为手机端用户：选择/拍照上传图片、填写订单 ID 与单据编号、
  一键“上传并签名上链”（模拟 SHA-256、钱包签名、交易签名与 Slot）。
- 右侧为 PC 端管理：自动同步单据，显示图片缩略图、哈希、交易签名；
  点“审核通过”后状态变为 `ON-CHAIN`，可放大查看图片与链上存证 JSON。
- 页面内置两张 HTML/CSS 流程图（非 SVG，兼容性好）：单据上链流程
  （随演示步骤实时高亮，支持“自动演示”循环播放）和贸易订单全流程
  （已创建→拨款→运输→清关→交付→还款→结清/违约）；点击节点可查看流程说明。
- 顶部和底部有演示步骤引导，可随时“重置演示”。

## 1. 前提

- Node 20+、pnpm、Docker（Postgres/Redis）。
- 本地 Solana 工具链或 docker localnet（见 README）。
- 浏览器安装 Phantom / Backpack / Solflare / Coinbase Wallet 任一钱包
  （或使用内置 UnsolvedBloom 适配器）。

## 2. 一键启动

```bash
./init-monorepo.sh --infra
cd packages/backend
pnpm exec prisma generate && pnpm exec prisma migrate deploy && pnpm exec prisma db seed
```

启动四个后端与前端：

```bash
scripts/dev-all.sh
```

前端：http://localhost:3100

## 3. 初始化链上数据

本地链需要先部署合约并创建 USDC/LP Mint：

```bash
cd packages/contracts
anchor build
# Agave 4.1.2 localnet 只接受 SBFv3（eBPF）程序，必须用 --arch v3 构建
cargo build-sbf --arch v3
cd ..
export PATH="$HOME/.local/share/solana/active_release/bin:$PATH"
solana airdrop 500 "$(solana address)"
solana program deploy packages/contracts/target/deploy/trade_finance.so \
  --program-id packages/contracts/target/deploy/trade_finance-keypair.json
solana program deploy packages/contracts/target/deploy/supply_chain.so \
  --program-id packages/contracts/target/deploy/supply_chain-keypair.json
node scripts/init-localnet.mjs
```

记录输出的 `USDC_MINT` / `LP_MINT`，用它们启动 trade/pool 服务（或写入环境）。

给演示钱包充值：

```bash
USDC_MINT=<上面输出的值> node scripts/fund-demo-wallet.mjs <钱包地址>
```

## 4. 演示账号

- 管理员：`admin@supply-chain.io` / `Admin123!`（首次登录会强制改密）。
- 普通用户：在 `/register` 注册；注册时建议填写钱包地址，或注册后用
  `/api/auth/wallet` 绑定钱包。

## 5. 推荐演示流程（约 10 分钟）

1. 管理员登录 → 强制改密 → `/admin/files`。
2. 普通用户注册 → 连接钱包 → `/user/upload` 上传单据（可拍照），
   填写 `tradeId` / `单据编号` → 上传 → “存证上链”签名确认。
3. 管理员在 `/admin/files` 审核通过（可填驳回理由）。
   可选：管理员在 `/admin/supply-chain` 初始化注册中心 → 授权供应商 →
   注册商品（需钱包签名），演示权限化供应链注册。
4. 用户 `/trade/new` 新建订单（金额、账期 30/60/90/120、卖方钱包）→
   钱包弹窗签名 → 跳转 `/orders` 看到 PENDING。
5. 管理员 `/orders` 点“详情”→ 拨款 → 推进运输中 → 清关 → 已交付 → 释放货款；
   买家在 REPAYING 看到还款倒计时 → 还款 → SETTLED。
6. 可选违约：在 FUNDED~DELIVERED 任一状态点“标记违约”，观察保险赔付与
   `/dashboard` 资金池 NAV。
7. `/dashboard` 展示池总规模、NAV、30/70 仓位和趋势图；管理员
   `/admin/withdrawals` 可看 LP 提款 7 天预告期。

## 6. 自动全链路验证

```bash
USDC_MINT=<输出> LP_MINT=<输出> node scripts/smoke-e2e.mjs
```

输出 `register/upload/attest/tradeLifecycle`、`supplyChainRegister`、
`supplyChainRejectUnauthorized` 全为 `true` 即完整工作流跑通。

## 7. 重置演示数据

- 数据库：`docker compose down && docker compose up -d` 后重跑
  `prisma migrate deploy && prisma db seed`。
- 链上：重建 localnet 后重新执行第 3 节，再重启 trade/pool（换新 Mint）。
