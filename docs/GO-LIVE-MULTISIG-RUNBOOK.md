# 主网上线 · Squads 多签迁移执行单（GO-LIVE RUNBOOK）

> 配套：`docs/Squads多签创建与Admin迁移手册.md`（机制详解）、`scripts/multisig-rehearsal/`（演练脚本）
> 前置：`precheck-mainnet-deploy.sh` 全 PASS；主网 Program 已部署（UA=冷钱包）或准备部署
> 安全：多签私钥/助记词**离线保管**，禁止入仓库/环境变量

## 0. 演练结论（2026-08-08，本地 validator 实测）

`scripts/multisig-rehearsal/run.sh` 已实测通过完整迁移通路：

| 步骤 | 结果 |
|---|---|
| initialize_pool（admin=旧 admin，delay=1s，test-build） | ✅ |
| propose_admin(多签) | ✅ |
| 未过时锁 accept → **被拒（AdminLockNotElapsed, 6042）** | ✅ 时锁生效 |
| 时锁后 accept_admin（多签签名） | ✅ |
| 链上 `pool.admin` == 多签地址 | ✅ PASS |

> 说明：演练用「模拟多签签名者」执行 accept（合约侧通路验证）；真实主网由 Squads 3-of-5 程序
> 以多签 PDA 身份签名执行同一指令。Squads 创建见第 1 步。

## 1. 创建 Squads 多签（3-of-5，主网）

- 推荐 **app.squads.so**（可视化）：
  1. 用**项目冷钱包**（成员之一）连接 → Create Squad
  2. 成员：运营×2 / 风控×1 / 财务×1 / 独立方×1；Threshold = **3**
  3. 记录 **Multisig PDA**（`<MULTISIG_PDA>`）
- CLI（可选，需 `@sqds/cli`）：`npx @sqds/cli create --threshold 3 --members <5 个成员地址>`
- 演练版创建脚本：`scripts/multisig-rehearsal/squads-create.mjs`（devnet/主网，需 SOL；含 `@sqds/multisig` 依赖说明）

## 2. 上线日顺序

### 2.1 配置
```bash
export MULTISIG_ADMIN=<MULTISIG_PDA>      # 写入 infra/config/production.env
export UPGRADE_AUTHORITY_PLAN=cold-wallet # 或 freeze
export INITIAL_ADMIN_DELAY=172800         # 48h（生产下限 86400）
export SOLANA_RPC_URL=<主网RPC> DEPLOY_WALLET=<冷钱包>
bash scripts/precheck-mainnet-deploy.sh   # 必须全 PASS（含 multisig admin）
```

### 2.2 部署 + 升级权限交多签（冷钱包签名）
```bash
# 全新部署（生成新 Program ID，自动同步 declare_id! / Anchor.toml）
bash scripts/deploy-mainnet.sh --yes --generate-keypairs

# 把 upgrade authority 交给多签（N-03；或 --freeze-upgrade-authority 冻结）
bash scripts/deploy-mainnet.sh --yes --upgrade-authority <MULTISIG_PDA>
#   等价命令（冷钱包）：
#   solana program set-upgrade-authority <TRADE_PID> --new-upgrade-authority <MULTISIG_PDA> --keypair <冷钱包>
#   solana program set-upgrade-authority <SUPPLY_PID> --new-upgrade-authority <MULTISIG_PDA> --keypair <冷钱包>
```

### 2.3 初始化（admin 一步到位 = 多签，推荐场景 A）
在 Squads UI 用多签执行：
- **initialize_pool**：admin(signer)=多签 PDA；账户 pool_state/admin/program_data/usdc_mint/lp_mint/pool_authority/system_program；
  参数 platform_wallet=平台钱包、initial_delay_secs≥86400（建议 172800）
- **initialize_registry**：admin=多签 PDA；initial_delay_secs≥86400
- ⚠️ 多签必须是程序 upgrade authority（步骤 2.2），否则 initialize 的 UA==admin 校验失败

### 2.4 若为已有池迁移（场景 B）
```bash
# 旧 admin 发起 propose（脚本已交付）
SOLANA_RPC_URL=<主网RPC> TARGET=trade NEW_ADMIN=<MULTISIG_PDA> \
  SOLANA_KEYPAIR_PATH=<旧admin keypair> node scripts/propose-admin.mjs
# 等时锁（pending_admin_delay_secs，生产默认 172800s = 48h）
# 多签执行 accept_admin / accept_registry_admin（Squads UI Create transaction → Execute）
```

## 3. 链上验证（放行依据）

```bash
# 1) pool.admin / registry.admin == 多签 PDA
bash scripts/verify-contract-deployment.sh   # 含 Program ID / UA 校验
# 2) 链上字节码 vs 审计源码一致性
SOLANA_RPC_URL=<主网RPC> TRADE_FINANCE_PROGRAM_ID=<TRADE_PID> \
  SUPPLY_CHAIN_PROGRAM_ID=<SUPPLY_PID> bash scripts/verify-deployment.sh
# 3) precheck 复跑：MULTISIG_ADMIN 检查 = PASS
# 4) 用多签执行一次管理操作（如 set_paused(true) → false）验证多签通路
# 5) 小额真实资金冒烟（smoke-e2e.mjs）→ 逐步放量
```

## 4. 回滚与注意事项

| 项 | 说明 |
|---|---|
| 时锁不可绕 | `set_admin_delay` 硬下限 86400；迁移失败可多签 propose 回旧 admin（同需时锁） |
| 冷钱包备份 | UA 交多签/冻结前，Program keypair + 冷钱包私钥离线备份 |
| LP mint authority | **必须 = pool_authority PDA**（initialize_pool 硬校验）；"交多签"只指程序 UA |
| 密钥安全 | 多签私钥离线；改动后复跑 `scan-secrets.sh` |
| 版本锁定 | 以 `audit-package-20260808.tar.gz`（SHA-256 见 deployment-info）为唯一权威，部署字节码与审计源码 SHA-256 比对 |

---
*生成 2026-08-08 · 演练实测通过 · 上线前逐项勾选并保留第三方复测签字（RETEST-SIGNOFF.md）*
