# Squads 多签创建与 Admin 迁移操作手册

> 用途：满足 DFR-2026-0148 上线前置 **N-03**（主网 admin 指向 Squads 多签 ≥3/5）
> 适用：trade-finance `pool.admin` 与 supply-chain `registry.admin`
> 前置：主网 Program 已部署（未初始化）或已有资金池（迁移）；`scripts/precheck-mainnet-deploy.sh` 已就绪
> 安全提示：**多签私钥/助记词离线保管，禁止入仓库、入环境变量**

---

## 0. 机制回顾（合约侧）

| 程序 | 迁移指令 | 签名要求 | 时锁 |
|------|----------|----------|------|
| trade-finance | `propose_admin(new_admin)` → `accept_admin()` | propose：旧 admin；accept：**new_admin（pending_admin）** | `pending_admin_delay_secs`（生产 ≥86400s，默认 172800） |
| supply-chain | `propose_registry_admin(new_admin)` → `accept_registry_admin()` | 同上 | `admin_delay_secs`（硬下限 86400） |

- 生产构建下 `initialize_*` 强制初始时锁 ≥86400；`set_admin_delay` / `set_registry_admin_delay` 有硬下限
- **accept 由新 admin（多签 PDA）签名** → 需通过 Squads 多签执行

---

## 1. 创建 Squads 多签（≥3/5）

### 1.1 推荐：Squads UI（app.squads.so，可视化，无需装工具）

1. 打开 https://app.squads.so → 用**项目冷钱包（成员之一）**连接（或用浏览器钱包如 Phantom/Solflare）
2. **Create Squad** → 填 `Multisig` 名称
3. 成员与阈值：
   - 建议 5 名成员：运营 ×2、风控 ×1、财务 ×1、**独立/外部方 ×1**
   - Threshold = **3**（3-of-5）
4. 创建后记录 **Multisig PDA 地址**（`<MULTISIG_PDA>`）——这是合约 admin 要填的地址
5. 将 PDA 填入 `infra/config/production.env.example` 的 `MULTISIG_ADMIN`（供 precheck）

> Squads V4 主网 program id 参考：`SMPLecH534NA9accyv9xwrq7u9x9haxudVdlZxwffbY`（创建后以 UI 显示的多签地址为准）

### 1.2 CLI/SDK 方式（可选，自动化）

```bash
# Squads V4 CLI（npm）——命令以官方 @sqds/cli 文档为准
npx @sqds/cli create --threshold 3 --members <成员1,成员2,成员3,成员4,成员5>
```
或使用 `@sqds/sdk`（TypeScript）创建。**以 https://docs.squads.so 官方文档为准**，创建后同样记录 PDA。

---

## 2. 场景 A：全新初始化（admin 直接 = 多签 PDA，推荐）

> 适用于主网 Program **尚未初始化**。这样无需迁移，一步到位。

1. **部署**：`bash scripts/deploy-mainnet.sh --yes --generate-keypairs`（冷钱包部署，保留 UA）
2. **初始化资金池**：`initialize_pool` 交易中：
   - `admin`（signer）= **冷钱包**（满足 H-01/N-05：admin == upgrade authority）
   - `PoolState.admin`（写入值）= **多签 PDA** —— 即指令参数/账户传多签 PDA 作为新 admin 地址
   - `platform_wallet` = 平台运营钱包
   - `initial_delay_secs` ≥ 86400（生产强制）
   - 用改造后的 `scripts/init-localnet.mjs`（把 admin 地址改为多签 PDA）执行
3. **初始化注册中心**：`initialize_registry(initial_delay_secs)` 同理，`registry.admin` = 多签 PDA
4. **验证**：见第 4 节

> 初始化后 `pool.admin` / `registry.admin` 即为多签 PDA；此后 fund/release/default/分红等管理操作**均需多签发起并投票通过**。

---

## 3. 场景 B：已有池子迁移（devnet/灰度池 → 多签）

> 适用于 **已初始化** 的资金池（如灰度期单签 admin）迁移到多签。

### 3.1 trade-finance：propose → 时锁 → accept

```bash
# 1) 旧 admin 发起 propose_admin(多签 PDA)
#    （旧 admin 是当前 pool.admin 的签名者）
#    可通过 Anchor TS SDK 或改造脚本调用：
#     program.methods.proposeAdmin(new MultisigPda)
#       .accounts({ poolState, admin: oldAdmin })
#       .signers([oldAdminKeypair])
```

2. **等待时锁**：`pending_admin_delay_secs`（生产默认 172800s = 48h；若灰度池设过更小值且 <86400 会被硬下限拒绝——保持 ≥86400）
3. **accept_admin（多签执行）**：
   - 在 Squads UI 中 **Create transaction** → 添加指令 `accept_admin`
     - `poolState`：资金池 PDA
     - `newAdmin`：**多签 PDA**（Squads 将以多签身份作为 signer 执行）
   - 签名人投票 → **Execute**
   - 执行后 `pool.admin` = 多签 PDA

### 3.2 supply-chain：propose_registry_admin → accept_registry_admin

同上，指令名为 `propose_registry_admin` / `accept_registry_admin`，账户 `registry` / `newAdmin`（多签 PDA）。

### 3.3 迁移期间
- propose 后、accept 前，旧 admin 仍可操作（两步轮换设计）
- 若担心迁移窗口，可在 propose 后暂停高风险操作（`set_paused(true)`），accept 后恢复

---

## 4. 验证

```bash
# 1) 读取 pool.admin 是否为多签 PDA
solana account <POOL_STATE_PDA> --output json | jq -r '.data[0]' | \
  python3 -c "import sys,base64,struct; d=base64.b64decode(sys.stdin.read()); print('admin:', d[8:40].hex())"  # 与多签 PDA 对比
# 或通过 get_pool_info 指令读取

# 2) 读取 registry.admin
solana account <REGISTRY_PDA> --output json | ...   # 偏移 8..40

# 3) precheck 强制校验
MULTISIG_ADMIN=<多签PDA> ... bash scripts/precheck-mainnet-deploy.sh   # multisig admin = PASS

# 4) 用多签执行一次管理操作（如 set_paused(true)）验证多签通路
```

---

## 5. 注意事项与回滚

| 事项 | 说明 |
|------|------|
| **时锁不可绕** | `set_admin_delay` / `set_registry_admin_delay` 有硬下限 86400；迁移前确认当前 delay |
| **冷钱包备份** | 未冻结 UA 前，Program keypair + 冷钱包私钥离线备份；丢失即失去升级与初始化能力 |
| **多签执行依赖** | accept 由多签执行需 Squads 网络/UI 可用；建议上线前做一次**多签执行演练**（测试网） |
| **回滚** | 若迁移失败/需回退：新 admin（多签）再 propose 回旧 admin（同样需时锁+多签 accept） |
| **密钥安全** | 多签私钥离线，禁止入 `.env`/仓库；`scan-secrets.sh` 应在改动后复跑 |
| **合规** | 多签签名人名单与治理流程文档化（DFR-0148 建议项） |

---

## 6. 上线日操作顺序（结合第 2/3 节）

1. Squads 多签创建完成（PDA 记录）
2. `MULTISIG_ADMIN=<PDA>` 写入 production.env，`UPGRADE_AUTHORITY_PLAN=cold-wallet|freeze`、`INITIAL_ADMIN_DELAY=172800`
3. `precheck-mainnet-deploy.sh` 全 PASS
4. 若全新部署 → 走场景 A；若已有池 → 走场景 B（提前 48h 发起 propose）
5. 初始化/迁移完成后按第 4 节验证
6. 小额真实资金冒烟（`smoke-e2e.mjs`）→ 多签操作验证 → 逐步放量

---

*生成：2026-08-08 · 对接合约 propose/accept 两步轮换与 precheck MULTISIG_ADMIN 检查 · Squads 具体命令以官方文档（app.squads.so / docs.squads.so）为准*
