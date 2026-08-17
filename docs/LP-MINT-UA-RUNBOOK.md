# 主网上线：LP mint 铸造 + UA 处置执行手册（B4/B5）

> 更新：2026-08-18。前置硬条件：部署钱包 `E9XtgfgqG5WpAxmGSCJsMwy7PRBCpnxgsLyScc8NhMkn` 已注资 ≥2 SOL（当前 0 SOL，未满足）。
> 主网 RPC：`https://mainnet.helius-rpc.com/?api-key=…`（已验证 getHealth=ok）。

## 一、LP mint 铸造（B4）

### 1.1 决策（审计已锁定，无选择余地）

| 项 | 值 | 依据 |
|---|---|---|
| decimals | **6** | 审计 N-01（LP mint decimals 0→6） |
| mint authority | **pool_authority PDA** | 合约 `initialize_pool` 硬校验（C-01） |
| freeze authority | **无（None）** | 合约硬校验（防止冻结 LP 账户阻断赎回） |

### 1.2 已算好的地址

- 主网 trade program：`5vLATpPELYKvVZhzDtxFwWxknFMQ2ozGjXCa6EHfnJ1E`
- **pool_authority PDA：`BXfrBcsoK3bExUpT8eZ2XWbwDAbc4Jyk7XKVfXrVLGGs`**（LP mint authority 必须等于它）

### 1.3 铸造命令（注资后执行）

```bash
spl-token create-token \
  --owner BXfrBcsoK3bExUpT8eZ2XWbwDAbc4Jyk7XKVfXrVLGGs \
  --no-freeze-authority \
  --decimals 6 \
  --fee-payer <部署钱包 keypair 路径>
```

- 输出 `Creating token <LP_MINT>` 即铸造完成（LP_MINT 是 32-44 位 base58 地址）
- 把 LP_MINT 写入 `deploy/vps/.env.app.mainnet` 的 `LP_MINT=` 行
- 之后 `deploy-mainnet.sh`（需 `LP_MINT` 已设置）与 `init-mainnet-pool.mjs` 即可运行

## 二、UA 处置（B5，三选一）

> UA（Upgrade Authority）= 主网程序升级权限。处置目标：避免单点密钥泄露导致合约被升级接管。
> 执行入口：`deploy-mainnet.sh`（部署时一并执行，程序部署完成后立即处置）。

| 方案 | 命令参数 | 特点 | 适用 |
|---|---|---|---|
| **A. 交 3/5 多签（推荐，N-03）** | `--upgrade-authority <MULTISIG_PDA>` | 升级需多签批准；可治理、可维护 | 上线初期，需先建 Squads 3/5 多签 |
| B. 冻结（--final） | `--freeze-upgrade-authority` | 永久无人可升级（不可逆）；最安全 | 合约成熟、确定不再升级后 |
| C. 冷钱包 | 不加参数（UA 保持部署 keypair） | 可升级但密钥需离线冷存 | 过渡方案，后续仍应冻结/交多签 |

推荐路径：**上线时先交 3/5 多签（方案 A）→ 业务稳定后再 `--final` 冻结（方案 B）**。

### 2.1 方案 A 前置：创建 Squads 3/5 多签

1. 确定成员名单：建议 **运营 2 + 风控 1 + 财务 1 + 独立方 1**（共 5 个钱包，3 票通过）
2. 用 [app.squads.so](https://app.squads.so) 创建 3/5 多签（或本地 `squads-multisig-cli`）
3. 得到 `MULTISIG_ADMIN`（多签 PDA 地址）→ 填入 `deploy/vps/.env.app.mainnet` 的 `MULTISIG_ADMIN=`
4. 部署时传 `--upgrade-authority <MULTISIG_PDA>`，UA 即交多签

### 2.2 处置后校验

```bash
solana program show <PROGRAM_ID> --url <MAINNET_RPC>   # 查看 upgrade authority 是否已变更为多签 PDA / None
```

## 三、执行顺序（注资后一条龙）

1. `spl-token create-token …`（上文 1.3）→ 拿到 LP_MINT → 写入 `.env.app.mainnet`
2. `bash scripts/precheck-mainnet-deploy.sh`（全 PASS）
3. `bash scripts/deploy-mainnet.sh --yes [--upgrade-authority <PDA> | --freeze-upgrade-authority]`
4. `bash scripts/init-mainnet.sh --yes --skip-deposit`（先不注资，小额起步）
5. `cp deploy/vps/.env.app.mainnet deploy/vps/.env.app && bash scripts/deploy-vps.sh`（切 VPS 到主网）

> 每步均为真实主网链上操作、不可逆，执行前逐项确认。
