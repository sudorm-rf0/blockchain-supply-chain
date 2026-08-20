# 链上密钥管理规范（Key Management）

> 目的：杜绝"部署钱包私钥丢失 / 链上版本落后 / 测试数据误导"类问题再次发生。
> 适用范围：所有 Solana 程序 keypair、部署钱包、治理多签相关密钥。

## 1. 密钥登记表（2026-08-20 盘点）

| keypair | 用途 | 位置 | 备份状态 | 状态 |
|---|---|---|---|---|
| devnet 旧部署钱包 `3rF9fK7...` | 旧合约 UA / 旧池 admin | **丢失**（本地/VPS 均未找到） | ❌ 无 | ⚠️ 已废弃（旧合约停用） |
| devnet 旧程序 keypair `9c8eND94/Dcxixk89` | 旧版合约（120/129 字节） | `target/deploy/legacy/` | ✅ 已备份 | ⚠️ 已废弃 |
| **devnet 新部署钱包 `FAB17dFi...`** | 新合约 UA / 新池 admin / 平台钱包 | `target/deploy/devnet-new/deployer-keypair.json` | ⚠️ **待冷备份** | ✅ 当前 devnet 在用 |
| devnet 新程序 keypair `8GSbCjUh/BGSBnaAs` | 新版合约 | `target/deploy/`（gitignore） | ✅ 已有副本 | ✅ 当前 devnet 在用 |
| mainnet 程序 keypair | 主网合约（未部署） | `target/deploy/mainnet/*.json` | ⚠️ **需离线冷存储** | 主网部署用 |
| 本地开发钱包 `9zEYzF...` | 本地/localnet 开发 | `~/.config/solana/id.json` | ⚠️ 需备份 | 普通钱包，非部署 |

## 2. 硬性规定（红线）

1. **keypair 一律不得入库**：`packages/contracts/target/` 已 gitignore；新增任何密钥文件前先确认 ignore。
2. **部署钱包必须冷备份**：新生成的部署钱包立即用加密介质（密码管理器/离线 U 盘）备份，并登记到本文档；**未备份前不得用于部署**。
3. **upgrade authority 优先交多签**：主网部署用 `--upgrade-authority <MULTISIG_PDA>`，避免单私钥失陷即失控（N-03 推荐）。
4. **丢失即事故**：任何部署/治理钱包私钥丢失立即在本文档标记 RED，并评估链上影响（该地址是否仍是 UA / admin / pool admin）。
5. **devnet 与 mainnet 严格隔离**：devnet 部署不得复用 mainnet keypair，反之亦然；`deploy-mainnet.sh` 已强制拒绝 devnet RPC 与 devnet 占位 ID。

## 3. 密钥生命周期

- **生成**：`solana-keygen new -o <path> --no-bip39-passphrase`，立即备份 + 登记。
- **使用**：部署/治理操作前核对登记表确认是正确环境的正确 keypair。
- **轮换**：devnet 钱包建议每次重大版本重建时换新；mainnet 钱包一经使用不轮换（升级走多签）。
- **销毁/废弃**：作废 keypair 移入 `target/deploy/legacy/` 并登记，不删除（保留审计追溯）。

## 4. 巡检要求

- 每次合约部署后运行：`bash scripts/verify-contract-deployment.sh`
- 定期（建议每周）运行链上安全巡检：`node scripts/onchain-security-audit.mjs`
- 巡检发现 upgrade authority 变更 / 池 paused / 账实不符 → 按 INCIDENT-RUNBOOK.md 处理

## 5. 当前 devnet 状态快照（2026-08-20）

- trade_finance: `8GSbCjUhgpvgQ35tx7wqFZCznP5HW2mn1jUYcGahC4tq`（新版 485 字节）
- supply_chain: `BGSBnaAs2uhsYhUA2KJBmirMcK551JLm9thy7P2y2cDh`
- pool: `BGuPKjqfC8tsBPmHUKkS2KVDMBGvbk21QH1R976KQm2r`
- USDC: `5kEWE1EbC6DYfg5548UBksbJ2VPue4yxiX3VUuHddRcC` / LP: `4fJthZiYPZ9uAqr38Uj2p2DJbPWjxUDP94Vo3RcwaWtw`
- 生产 `.env.app` 已指向以上地址（备份 `.env.app.bak.*`）
