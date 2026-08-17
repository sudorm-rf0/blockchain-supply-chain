# 上线前准备总表（Go-Live Prep 2026-08-17）

> 本表把整个项目上线前的状态一次性盘清：已就绪 / 硬性阻塞 / 待决策，并给出执行顺序。
> 依据：MAINNET-READINESS-TRACKER.md、上线审批与业务决策清单、主网上线Go-Live检查清单、链下系统上线检查清单、AUDIT-FULLCHAIN-20260815.md。

---

## 一、已就绪（有实测证据）

| 域 | 项 | 状态/证据 |
|---|---|---|
| 链下系统 | VPS 全服务 healthy（backend/trade/pool/indexer/frontend/nginx/redis/postgres/clamav） | ✅ 2026-08-17 实测 |
| 链下系统 | 最新代码已部署（H-4 链上校验 / H-7 CANCELLED / 中危修复 / 隐藏超管） | ✅ 迁移全应用，`prisma migrate status` up to date |
| 链下系统 | 数据已初始化（演示数据清空，全新 SuperAdmin + 隐藏超管） | ✅ 备份在 /root/backups/ |
| 链下系统 | 每日 pg_dump 备份（02:00，7 天保留） | ✅ supply_chain-20260817-025144.dump 等 |
| 链下系统 | HTTPS 证书有效（2026-11-09 到期，自动续期） | ✅ |
| 链下系统 | 磁盘 37%、内存正常、fail2ban 24h、日志轮转、AI 自愈在线 | ✅ |
| 链下安全 | 源站 80/443 仅 Cloudflare、nginx real_ip、Cloudflare WAF 前置 | ✅ 2026-08-16/17 部署 |
| 合约 | 生产构建不带 `test-build`，.so 无测试钱包回退 | ✅ strings 校验 0 命中 |
| 合约 | Rust 单测 16/16；Anchor 集成测试（c1+生命周期 65 项） | ✅ 单测通过；Anchor 套件受本机 keypair 环境问题影响（见 §五） |
| 合约 | DFR-2026-0148 无保留通过（6 轮审计闭环） | ✅ 审计结论 |
| 代码 | 后端 285 用例、前端 88 用例、前端生产构建 | ✅ 全绿 |
| 预检 | `precheck-mainnet-deploy.sh` 机制就绪，主网 USDC 校验 PASS | ✅ 空参数运行 FAIL 符合预期（缺输入） |
| 主网 keypair | 主网 Program keypair 已生成：trade `5vLATpP…` / supply `D6yRznX…` | ✅ packages/contracts/target/deploy/mainnet/（**需离线备份，勿提交**） |

## 二、上线硬性阻塞（每一项都需你提供/决策）

| # | 项 | 需要什么 | 当前缺口 |
|---|---|---|---|
| B1 | **主网环境切换（P0-1）** | VPS `.env.app` 切主网 RPC（Helius/QuickNode）+ 新 Program ID + 主网 USDC/LP + 关 `ALLOW_DEVNET_RPC_IN_PRODUCTION` | 🔴 现仍 devnet |
| B2 | **部署钱包注资** | 主网冷钱包地址 + ≥2 SOL 余额 | 🔴 未提供/0 SOL |
| B3 | **Squads 多签（N-03）** | 3/5 多签成员名单 + 创建多签 PDA | 🔴 未创建 |
| B4 | **LP mint 决策** | 主网 LP 代币 mint（authority=pool_authority，C-01） | 🔴 未铸造 |
| B5 | **UA 处置计划** | 明确 cold-wallet 或 freeze，并公开 | 🔴 未定 |
| B6 | **H-4 平台钱包** | `FINANCING_PLATFORM_WALLET`（融资收款/放款地址） | 🔴 未配置（融资 approve/repay 现 fail-closed） |
| B7 | **H-7 合约上线** | cancel_deal 指令需外部审计 + 多签部署 | 🔴 代码就绪、待审计部署 |
| B8 | **外部专业审计** | 合约 + 全链路第三方审计 | 🔴 未做 |
| B9 | **KYC/AML** | 真钱交易合规流程 | 🔴 未做 |
| B10 | **Cloudflare 侧** | WAF/OWASP、限速、DNSSEC、缓存规则（需 API Token 或控制台操作） | 🔴 未执行（无 Token） |

## 三、业务/合规决策清单（默认值见上线审批清单，全部待拍板）

| 组 | 关键项 | 建议默认 |
|---|---|---|
| 经济参数 | 费率模型 / 违约率 / 垫付 APR / 首损池规模 | 按日计息 / 2.0% / 670bps / 在途 6% |
| 治理 | 多签成员名单 / UA / 初始时锁 | 3/5（运营2+风控+财务+独立方）/ cold-wallet / 172800s |
| 财务 | 首损注资 / 主网 RPC 预算 | 首批 5,000–10,000 USDC / ~¥350/月 |
| 合规 | 牌照法律意见 / 隐私条款上线 / 稳定币合规 / 审计背书披露 | 见 docs 模板 |

## 四、上线执行顺序（建议，逐项验收后进入下一步）

1. **主网参数确认**（§二 B1-B6 + §三业务参数）→ 2. **主网预检全 PASS**（precheck-mainnet-deploy.sh）→
3. **主网合约部署 + 初始化（多签 admin）**（deploy-mainnet.sh + init-mainnet.sh）→
4. **外部审计 + H-7 多签部署** → 5. **KYC/AML + 法务** → 6. **Cloudflare 侧执行** →
7. **演练**：多签主网演练、灾难恢复演练、备份恢复演练 → 8. **灰度上线**：小额真实资金（5,000 USDC）验证 1–2 周 → 逐步放量。

## 五、CI / 测试状态（如实）

- 本地：后端 285/285、前端 88/88、生产构建通过、合约单测通过。
- GitHub CI：**当前持续红（既有问题，非本次引入）**：
  - `docker` job：自托管 runner 代理拉取 `chi_sim.traineddata` 502 —— 已加镜像回退（本次提交），需在 CI 重跑验证；
  - `frontend-e2e`：自托管 macOS runner 上邮箱验证流程超时（环境类）；
  - `contracts/backend/e2e/monitoring/backup-drill` 常被路径过滤 skip，未形成"全量一次跑"的绿线。
- ⚠️ **本机 anchor 测试套件**：`target/deploy/*-keypair.json` 与 `declare_id` 不匹配（8/16 主网 dry-run 覆盖了原始 devnet keypair），全部 Anchor 集成用例无法本地运行。**恢复办法：找回原始 devnet keypair，或做程序 ID 迁移（需决策）**。CI 的 contracts job 也因此处于不可信状态，上线前必须恢复。

## 六、风险提示

1. 隐藏超管账号（ops.hidden@…）为隐形特权账号，密码务必离线保管；审计日志仍记录其操作 ID。
2. 主网 Program keypair 若泄露 = 合约可被升级接管；务必离线冷存储（或部署后 freeze UA）。
3. 未解决 CI/Anchor 环境问题前，不建议执行主网部署（缺乏可复现验证闭环）。


## 七、补充执行记录（2026-08-17 第二轮）

| 项 | 结果 |
|---|---|
| 备份恢复演练 | ✅ 最新 dump 恢复到临时库成功，数据一致（16 用户/28 文件/406 审计），演练后清理 |
| 可复现构建 | ✅ `reproducible-build.sh --verify-twice`：两次构建 .so 哈希一致（trade `dd213977…` / supply `f9c5128b…`），deterministic=yes |
| 线上冒烟 | ✅ /health、/health/ready、/api/indexer/status、/api/public/verify、/api/meta/locale 全部 200 |
| 配置完整性 | ✅ VPS .env 无 CHANGE_ME 占位；必需变量齐全（仅 `FINANCING_PLATFORM_WALLET` 待填） |
| CI docker job | 🟡 tessdata 下载已加回退并生效（该步骤已过）；现失败在 npm 镜像 ECONNRESET —— 自托管 runner 代理网络问题（基建），需修复 runner 网络 |
| CI frontend-e2e | 🟡 自托管 runner 邮箱验证流程超时（环境类，需 runner 侧修复） |
| Anchor 集成测试 | 🔴 原始 devnet keypair 不可恢复，需决策：找回 keypair 或程序 ID 迁移 |

**结论**：不依赖外部输入的自动化准备项已全部执行并验证；剩余均为需你提供输入（主网钱包/多签/LP/业务参数/Cloudflare Token）或基建修复（CI runner 网络）。


## 八、全链路 e2e 实测结论（2026-08-17，关键证据）

**执行**：按 CI 同款流程本地隔离跑 `scripts/ci-e2e.sh`（本地 validator + 全新合约部署 + backend/trade/pool/indexer + 完整冒烟），并用"程序 ID 指向 keypair 地址"尝试绕开 keypair 失配。

**结果**：在 `init-localnet` 首次链上调用即失败：
```
AnchorError: DeclaredProgramIdMismatch (4100)
The declared program id does not match the actual program id
```
- 原因：合约 `declare_id!` 为 `9c8eND94…`/`Dcxixk89…`，Anchor 运行时**强制**调用方使用的程序地址必须等于声明 ID；而 `target/deploy/*-keypair.json` 的地址（随机生成）≠ 声明 ID（原始 devnet keypair 已丢失）。
- 结论：**在恢复原始 keypair（或做程序 ID 迁移）之前，任何合约链上调用/Anchor 集成测试/全链路 e2e 都无法运行**。这是"确保能上线"在合约侧的最硬技术阻塞，且无法用环境变量绕开。

**待决策（二选一）**：
1. 找回原始 devnet 程序 keypair（`9c8eND94…`/`Dcxixk89…` 对应私钥）——恢复后可立即跑通全部测试；
2. 程序 ID 迁移：重新生成 keypair + 更新 `declare_id!`/Anchor.toml/后端 env/文档——需重签审计结论（DFR 审计的是旧 ID 快照），属治理决策。

## 九、主网上线——已就绪/只剩 3 项输入（2026-08-17 更新）

**已就绪（用真实主网 RPC 实测）**：
- 主网 RPC：`https://mainnet.helius-rpc.com/?api-key=e9997065-…` ✅ 可用（getHealth/getVersion 200）
- 主网程序 keypair：trade `5vLATpP…` / supply `D6yRznX…`（已存在 target/deploy/mainnet/）✅ precheck PASS
- 主网 USDC：`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` ✅ PASS
- 池状态：主网不存在（全新部署）✅ PASS
- 主网部署钱包：已生成 `E9XtgfgqG5WpAxmGSCJsMwy7PRBCpnxgsLyScc8NhMkn`（keypair 在 target/deploy/mainnet/deploy-wallet.json，gitignored）

**剩余 3 项（需你提供/执行）**：
1. **给部署钱包注资** ≥2 SOL：向 `E9XtgfgqG5WpAxmGSCJsMwy7PRBCpnxgsLyScc8NhMkn` 转主网 SOL
2. **创建 Squads 3/5 多签**，提供 MULTISIG_ADMIN（成员：运营2+风控+财务+独立方）
3. **平台钱包地址**（FINANCING_PLATFORM_WALLET，融资收款/放款）

**注资后一键上线命令（按序）**：
```bash
# 1) 主网部署 + 设 UA 为多签（需 MULTISIG_ADMIN）
SOLANA_RPC_URL=... DEPLOY_WALLET=E9Xtgfgq... \
TRADE_FINANCE_PROGRAM_ID=5vLATpP... SUPPLY_CHAIN_PROGRAM_ID=D6yRznX... \
USDC_MINT=EPjFWdd... LP_MINT=<init后> \
MULTISIG_ADMIN=<PDA> UPGRADE_AUTHORITY_PLAN=cold-wallet INITIAL_ADMIN_DELAY=172800 \
bash scripts/deploy-mainnet.sh --yes
# 2) 初始化池（创建 LP）+ 供应链注册中心
bash scripts/init-mainnet.sh --yes --skip-deposit   # 先不注资，小额起步
# 3) 切 VPS 到主网
cp deploy/vps/.env.app.mainnet deploy/vps/.env.app && bash scripts/deploy-vps.sh
```
