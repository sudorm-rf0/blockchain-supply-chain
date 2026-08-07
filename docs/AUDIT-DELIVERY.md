# 第三方审计：状态与材料（2026-08-07 更新）

> 本文档记录审计相关状态与材料。**注意：真实第三方审计尚未执行**——
> 仓库内的 `AUDIT-REPORT.md` / `CERTIK-REPORT.md` 为**项目内部安全评估**
> （参考 Trail of Bits / CertiK 方法论撰写，已注明非机构交付物）。

## 1. 审计状态

| 项 | 结果 |
|---|---|
| **内部安全评估** | ✅ 完成（B+，无 Critical/High，2 个中危已修复复核）——见 `docs/AUDIT-REPORT.md`、`docs/CERTIK-REPORT.md` |
| **真实第三方审计** | ⏳ **待进行**——上线硬门槛，需独立机构出具报告（审计材料包已备好） |
| 内部评估结论 | 合约核心逻辑正确、`checked_*` 算术保护完备、权限校验（PDA/Token 账户/签名）覆盖全面；未发现可直接导致资金损失的漏洞 |

## 2. 审计材料包（供询价/机构审查）

| 项 | 说明 |
|---|---|
| 位置 | `dist-audit/audit-package-<日期>.tar.gz`（本地生成，不入库） |
| 重新生成 | `bash scripts/build-audit-package.sh` |
| 内容 | 合约源码、Anchor 测试（43）、内部评估/经济模型/已知风险文档、部署信息（无私钥） |
| 用途 | 发给审计机构询价/审查，或供客户/监管说明审计范围 |

## 3. 询价邮件模板（复制修改后发送）

```
主题：Solana 供应链金融合约第三方审计询价（Anchor trade-finance + supply-chain）

尊敬的 [审计机构]：

我们计划对两个 Solana/Anchor（0.31.1 / Agave 4.1.2，SBFv3）合约进行第三方安全审计，
希望获取报价与排期。

- 合约：trade-finance（资金池、订单全生命周期、违约清算、LP 赎回、分红与买方返利）
  + supply-chain（权限化供应商注册）；约 2000 行 Rust；43 个 Anchor 集成测试通过
- 已有材料：内部安全评估、经济模型说明、已知风险清单、完整测试套件（可打包发送）
- 重点：DistributeDividends、买方返利账本、LP mint authority 链下铸币、
  default 保险路径、u64 边界、集中度限制、权限模型
- 期望交付：漏洞报告（分级）、修复建议、复测确认

请提供：报价、预计周期、交付物清单、是否支持复测。
附件：audit-package-<日期>.tar.gz（如需）
```

## 4. 内部评估遗留建议（纳入后续迭代）

| 编号 | 建议 | 优先级 | 状态 |
|---|---|---|---|
| S-01 | 将 `usdc_mint`/`lp_mint` 纳入 `PoolState` 并加 `require_keys_eq!` 链上锚定 | 建议 | ⏳ 后续版本（当前以链下校验 + 负面测试兜底） |
| S-02 | `initialize_pool` 二次初始化保护 | 低 | 待评估 |
| S-03 | 合约按指令拆分目录 | 低 | 待评估 |
| S-04 | `RedeemLp` 50% 上限改治理参数 | 低 | 待评估 |
| B-01~B-03 / F-01~F-03 | 后端/前端优化建议 | 低 | 待评估 |

> ⚠️ 若对合约核心逻辑再做修改（业务常量、账户结构、指令签名），真实审计后应重新审计。

## 5. 真实审计通过后的上线路径

1. **真实部署**：`deploy/vps`（2×VPS）或 K8s 部署 + 全链路冒烟（`scripts/smoke-e2e.mjs`）。
2. **主网**：`deploy-mainnet.sh --yes --generate-keypairs` 部署合约 →
   `init-mainnet.sh --yes` 初始化资金池/Registry（小额真实 USDC 起步）。
3. **配置**：主网 RPC 付费套餐 + `SOLANA_RPC_URL`/Program ID/USDC/LP 回填
   （见 [MAINNET-MIGRATION.md](MAINNET-MIGRATION.md) 配置替换表）。
4. **灰度**：小额真实资金跑 1-2 个月 → 对账（`scripts/reconcile`）无差异 → 放量。
5. **成本**：见 [COSTS.md](COSTS.md) 5 笔/日场景（约 ¥485-607/月）。

## 6. 与上线核对清单的关系

- [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) "由独立审计方完成合约审计"一项：**⏳ 待进行**（未勾选）。
- [PHASE2-CLOUD-CHECKLIST.md](PHASE2-CLOUD-CHECKLIST.md) P0 第一项"第三方合约审计"：**⏳ 待进行**，
  材料包与询价模板已备，联系机构询价后即可推进。

## 6. DFR 审计整改状态（2026-08-07）

- 依据 DFR-SC-2026-0143 / DFR-2026-0143，C-01、H-01、H-02、H-03、M-01~M-11、L-02、L-03、L-06、L-08、I-02、I-05 已完成合约层整改（见 docs/AUDIT-KNOWN-RISKS.md）。
- 测试：Rust 单测 15/15、Anchor 集成 55/55、后端 Jest 146/146、前端 Vitest 48/48。
- 待办：H-04 费率重构（业务论证）、多签部署、`ADMIN_TRANSFER_DELAY_SECS` 上线前调为 >= 48h、提交 DFR 复测。
