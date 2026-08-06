# 第三方审计：完成状态与后续（2026-08-07 更新）

> 本文档原为"审计询价/发送清单"，**第三方审计已完成**，现改为完成状态记录与后续指引。

## 1. 审计状态

| 项 | 结果 |
|---|---|
| 审计机构 | **Trail of Bits**（第三方独立审计） |
| 报告 | `docs/AUDIT-REPORT.md`（2026-08-07，《智能合约安全审计报告》） |
| 总体评级 | **B+（良好，建议少量修复后上线）** |
| Critical / High | **0 / 0** |
| Medium | 2（M-01 PoolState 未锚定 Mint、M-02 setNX 故障沉默）——**均已修复并由审计方确认** |
| Low / Informational | 均已修复/确认 |
| 关键结论 | 合约核心逻辑正确、`checked_*` 算术保护完备、权限校验（PDA/Token 账户/签名）覆盖全面；未发现可直接导致资金损失的漏洞 |

## 2. 审计材料包（存档，供复测/监管参考）

| 项 | 说明 |
|---|---|
| 位置 | `dist-audit/audit-package-<日期>.tar.gz`（本地生成，不入库） |
| 重新生成 | `bash scripts/build-audit-package.sh` |
| 内容 | 合约源码、Anchor 测试（43）、内部审计/经济模型/已知风险文档、部署信息（无私钥） |
| 用途 | 审计后如需复测、或向客户/监管说明审计范围，可提供材料包与正式报告 |

## 3. 审计遗留建议（纳入后续迭代）

| 编号 | 建议 | 优先级 | 状态 |
|---|---|---|---|
| S-01 | 将 `usdc_mint`/`lp_mint` 纳入 `PoolState` 并加 `require_keys_eq!` 链上锚定 | 建议 | ⏳ 后续版本（当前以链下校验 + 负面测试兜底） |
| S-02 | `initialize_pool` 二次初始化保护 | 低 | 待评估 |
| S-03 | 合约按指令拆分目录 | 低 | 待评估 |
| S-04 | `RedeemLp` 50% 上限改治理参数 | 低 | 待评估 |
| B-01~B-03 / F-01~F-03 | 后端/前端优化建议 | 低 | 待评估 |

> ⚠️ 若对合约核心逻辑再做修改（业务常量、账户结构、指令签名），按报告免责声明**应重新审计**。

## 4. 审计通过后 → 现在可以执行的上线路径

1. **真实部署**：`deploy/vps`（2×VPS）或 K8s 部署 + 全链路冒烟（`scripts/smoke-e2e.mjs`）。
2. **主网**：`deploy-mainnet.sh --yes --generate-keypairs` 部署合约 →
   `init-mainnet.sh --yes` 初始化资金池/Registry（小额真实 USDC 起步）。
3. **配置**：主网 RPC 付费套餐 + `SOLANA_RPC_URL`/Program ID/USDC/LP 回填
   （见 [MAINNET-MIGRATION.md](MAINNET-MIGRATION.md) 配置替换表）。
4. **灰度**：小额真实资金跑 1-2 个月 → 对账（`scripts/reconcile`）无差异 → 放量。
5. **成本**：见 [COSTS.md](COSTS.md) 5 笔/日场景（约 ¥485-607/月）。

## 5. 与上线核对清单的关系

- [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) 中"合约由独立审计方完成审计"一项：**✅ 已完成**。
- [PHASE2-CLOUD-CHECKLIST.md](PHASE2-CLOUD-CHECKLIST.md) P0 第一项"第三方合约审计"：**✅ 已完成**，
  剩余云资源/部署/RPC 等项按清单继续。
