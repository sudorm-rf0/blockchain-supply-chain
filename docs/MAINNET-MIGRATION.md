# devnet → 主网迁移清单

代码**完全不用改**（合约、后端、前端、CI 全部复用），迁移 = 重新部署到主网 +
换配置 + 重建链上状态。以下按顺序执行，配合 [GO-LIVE-RUNBOOK.md](GO-LIVE-RUNBOOK.md)
与 [PHASE2-CLOUD-CHECKLIST.md](PHASE2-CLOUD-CHECKLIST.md)。

## 0. 前置条件（不满足不开始）

- [ ] 第三方合约审计通过，高危/中危已修复并复测（含 2026-08-06 新加的分红/返利逻辑）
- [ ] 主网 RPC 已就绪（Helius/QuickNode **付费档**，devnet 免费档 20.9 RPS/26% 429 不达标）
- [ ] 主网部署钱包为**独立冷钱包**，有足够 SOL；`upgrade authority` 私钥离线保管
- [ ] LP mint authority 必须是 `pool_authority` PDA（审计 C-01：铸币收归合约控制，`createMint(poolAuthority, 0 decimals, 无 freeze)`；脚本 `init-mainnet-pool.mjs` 会校验）
- [ ] 真实供应商钱包地址已收集

## 1. 链上需要"重建"的部分（devnet 状态不会迁移）

| 项 | devnet（现状） | 主网（要新建） |
|---|---|---|
| trade-finance Program ID | `9c8eND94...RVU3` | **新 keypair 生成新 ID**（严禁复用 devnet ID） |
| supply-chain Program ID | `Dcxixk89...C6Lk` | **新 ID** |
| PoolState | `FyPxzVPL...` | 主网 USDC 重新 `initialize_pool` + 真实存款 |
| USDC Mint | 测试 `2MTv8Nw...` | 主网 `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| LP Mint | 测试 `HkPYrCPb...` | 新建（authority = poolAuthority PDA，0 decimals） |
| Registry/供应商 | `FcLKzAMh...` | 重新 `init-supply-chain.mjs` 授权真实供应商 |
| 测试订单/文件/用户 | 冒烟残留 | 不迁移，主网全新 |

## 2. 配置替换清单

| 变量 | devnet 值 | 主网值 |
|---|---|---|
| `SOLANA_RPC_URL` | devnet URL | 主网 RPC（可逗号分隔多 Key 轮询） |
| `NEXT_PUBLIC_RPC_URL` | devnet | 主网 RPC |
| `USDC_MINT` | 测试 mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `LP_MINT` | 测试 mint | 新 LP mint |
| `TRADE_FINANCE_PROGRAM_ID` | 9c8eND... | 新 ID |
| `SUPPLY_CHAIN_PROGRAM_ID` | Dcxixk... | 新 ID |
| `POOL_STATE_ADDRESS` | 空（自动推导） | 主网 Pool PDA |
| `NODE_ENV` | development | `production`（强制校验 LP_MINT） |
| `ALLOWED_ORIGIN` | localhost | 真实域名 |
| `JWT_SECRET` / `WEBHOOK_SECRET` | dev 值 | `openssl rand -hex 32` 新值 |

## 3. 部署与验证步骤（顺序执行）

```bash
# 1) 主网预检（RPC/钱包/代币/Program ID 非 dev 占位）
SOLANA_RPC_URL=<主网> DEPLOY_WALLET=<冷钱包> \
TRADE_FINANCE_PROGRAM_ID=<新ID> SUPPLY_CHAIN_PROGRAM_ID=<新ID> \
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v LP_MINT=<新LP> \
bash scripts/precheck-mainnet-deploy.sh

# 2) 一键部署（含预检/全新 keypair/可选冻结升级权限；--dry-run 先预览）
SOLANA_RPC_URL=<主网RPC> DEPLOY_WALLET=<冷钱包> \
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v LP_MINT=<新LP> \
bash scripts/deploy-mainnet.sh --dry-run --yes --generate-keypairs   # 预览
bash scripts/deploy-mainnet.sh --yes --generate-keypairs             # 正式部署
# 部署后冻结升级权限（可选，不可逆）：
bash scripts/deploy-mainnet.sh --yes --freeze-upgrade-authority

# 3) 初始化资金池 + 真实存款 + Registry（一键编排，先 --dry-run 预览）
SOLANA_RPC_URL=<主网RPC> TRADE_FINANCE_PROGRAM_ID=<新ID> \
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v LP_MINT=<新LP> \
DEPOSIT_USDC=1000 \
bash scripts/init-mainnet.sh --dry-run --yes <真实供应商公钥...>   # 预览
bash scripts/init-mainnet.sh --yes <真实供应商公钥...>            # 正式（小额起步）
# 只初始化池不存款：bash scripts/init-mainnet.sh --yes --skip-deposit

# 5) 部署服务（VPS 或 K8s，见 deploy/vps 或 DEPLOYMENT.md）+ 数据库迁移

# 6) 主网全链路冒烟（小额真实资金）
SOLANA_RPC_URL=<主网> USDC_MINT=<主网> LP_MINT=<主网> \
node scripts/smoke-e2e.mjs

# 7) 链上核对
SOLANA_RPC_URL=<主网> TRADE_FINANCE_PROGRAM_ID=<新ID> USDC_MINT=<主网> LP_MINT=<主网> \
ADMIN_WALLET=<冷钱包> bash scripts/verify-contract-deployment.sh
```

## 4. 上线后必须重跑的测试/演练

- [ ] 主网 RPC 压测达标：`rpc-load-test.mjs` ≥50 RPS、p95 < 500ms
- [ ] 真实 VPS/K8s 全链路冒烟（注册→上传→存证→建单→拨款→推进→还款）
- [ ] 备份恢复演练：`scripts/db-backup-restore.sh drill`
- [ ] 监控/告警连续运行 30 分钟无新增告警
- [ ] 管理员 TOTP 已开启、默认密码已更换、域名/Origin 校验通过
- [ ] **小额真实资金灰度**：先 5-50 万级跑 1-2 个月，验证合约、索引器、对账闭环，再放量

## 5. 什么不用变

- 合约/后端/前端**代码**（0 改动）
- 测试体系（CI localnet + devnet 冒烟继续当回归）
- devnet 环境（保留为开发/演示/回归，和主网并行）
