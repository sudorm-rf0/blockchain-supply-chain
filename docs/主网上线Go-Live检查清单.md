# 主网上线 Go-Live 检查清单

> 依据：DFR-2026-0148（无保留意见/通过）+ MAINNET-MIGRATION.md + 首损池 SOP
> 状态：合约层审计已闭环，本清单为上线当日执行项
> 前置：DFR 六轮复测通过（0143 否定 → 0148 无保留通过）

---

## 0. 上线前状态确认（必须先满足）

- [ ] DFR-2026-0148 无保留意见（通过）已取得（✅ 已取得）
- [ ] 生产构建**不带** `test-build` feature（`anchor build` 默认）
- [ ] 测试套件通过：Rust 22/22、Anchor 65/65
- [ ] 主网 RPC 付费档就绪（Helius/QuickNode）

---

## 1. N-03：Squads 多签治理落地（T-0 必须）

### 1.1 创建多签
```bash
# 使用 Squads CLI 或 UI（app.squads.so）创建 3/5 多签
# 签名人建议：2 名项目运营 + 1 名风控 + 1 名财务 + 1 名独立/外部方
squads create --threshold 3 --members <运营1,运营2,风控,财务,独立方>
# 记录多签 PDA 地址：<MULTISIG_PDA>
```

### 1.2 初始化时 admin 指向多签
- `initialize_pool` 的 admin = **多签 PDA**（而非部署钱包）
- `initialize_registry` 的 admin = **多签 PDA**
- 初始化需多签执行（Squads 发起交易，签名人投票）

### 1.3 precheck 强制校验
```bash
MULTISIG_ADMIN=<MULTISIG_PDA> \
UPGRADE_AUTHORITY_PLAN=cold-wallet \
INITIAL_ADMIN_DELAY=172800 \
DEPLOY_WALLET=<冷钱包> \
SOLANA_RPC_URL=<主网RPC> \
TRADE_FINANCE_PROGRAM_ID=<新ID> \
SUPPLY_CHAIN_PROGRAM_ID=<新ID> \
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
LP_MINT=<新建LP mint> \
bash scripts/precheck-mainnet-deploy.sh
```
预期：全部 PASS（含 multisig admin、upgrade authority plan、initial admin delay、deploy wallet != 测试 DEPLOYER）

---

## 2. UA 冻结策略执行（T-0 必须）

### 2.1 冷钱包 UA 方案（推荐，保留升级能力）
```bash
# 部署时 upgrade authority = 冷钱包（离线保管私钥）
bash scripts/deploy-mainnet.sh --yes          # 含 precheck + 全新 keypair
# 初始化（多签 admin）后，冷钱包保留 upgrade authority，离线保管
```

### 2.2 冻结方案（不可逆，谨慎）
```bash
# 初始化完成、验证无误后冻结：
bash scripts/deploy-mainnet.sh --yes --freeze-upgrade-authority
# ⚠️ 冻结后无法升级合约；重大变更需重新部署新 Program
```

### 2.3 决策记录
- [ ] 明确 UA 处置计划（cold-wallet 保留 或 freeze）
- [ ] 公开处置计划（README/治理文档）
- [ ] 冷钱包私钥离线保管流程确认

---

## 3. 首损池注资（按 SOP）

- [ ] 平台财务按 SOP 注入首损资金（建议在途垫付 6%）
- [ ] 链上 `first_loss_reserve` 与 SOP 对账一致
- [ ] 对外披露首损规模

---

## 4. 费率参数确认（H-04）

- [ ] `fee_apy_bps` 最终值经业务/风控确认（默认 670 = 6.7% APR）
- [ ] 分配比例（LP/平台/返利 40/50/10）确认
- [ ] `set_fee_params` 由多签执行

---

## 5. 主网部署步骤（顺序执行）

```bash
# 1) precheck（见 1.3）
# 2) 部署（全新 keypair）
bash scripts/deploy-mainnet.sh --yes --dry-run   # 先预览
bash scripts/deploy-mainnet.sh --yes             # 正式部署
# 3) 初始化（多签）
bash scripts/init-mainnet.sh --yes --dry-run
bash scripts/init-mainnet.sh --yes               # 池初始化 + 存款
# 4) Registry + 供应商授权（多签）
node scripts/init-supply-chain.mjs <供应商公钥...>
# 5) 服务部署 + 数据库迁移（VPS/K8s）
# 6) 小额灰度（见下）
```

---

## 6. 小额真实资金灰度（上线验证）

- [ ] 首笔 5-50 万 USDC 级灰度运行 1-2 个月
- [ ] 全链路冒烟：注册 → 上传 → 存证 → 建单 → 拨款 → 物流推进 → 还款
- [ ] 对账闭环：链上 vs 数据库每日对账一致
- [ ] 监控/告警连续运行无新增告警
- [ ] 违约路径演练（小额订单模拟违约，验证保险+首损瀑布）
- [ ] 赎回路径演练（LP 赎回，验证 equity_base 定价 + 窗口）
- [ ] 管理员轮换演练（多签 propose/accept + 48h 时锁）
- [ ] 暂停/恢复演练（set_paused）

---

## 7. 上线后持续项

- [ ] 每日链上对账（reconcile.mjs）
- [ ] 违约事件风控 Webhook 告警
- [ ] 首损池水位监控（<3% 预警，<1.8% 紧急）
- [ ] 多签阈值/签名人治理流程文档化
- [ ] 升级权限处置记录归档
- [ ] 向 DFR 提交部署凭证，触发验收性复测

---

## 8. 快速状态卡

| 项 | 状态 | 责任人 |
|----|------|--------|
| DFR 无保留通过 | ✅ | 审计 |
| Squads 多签创建 | ⬜ | 运营 |
| precheck 全 PASS | ⬜ | DevOps |
| 部署 + 初始化 | ⬜ | DevOps |
| 首损注资 | ⬜ | 财务 |
| 费率确认 | ⬜ | 业务 |
| 小额灰度 | ⬜ | 运营 |

---

*生成：2026-08-07 · 与 DFR-2026-0148 无保留通过配套 · 上线执行用*
