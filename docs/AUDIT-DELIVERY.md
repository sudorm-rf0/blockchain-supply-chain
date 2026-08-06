# 第三方审计：发送清单与询价模板

## 1. 审计材料包

| 项 | 说明 |
|---|---|
| 位置 | `dist-audit/audit-package-<日期>.tar.gz`（本地生成，不入库） |
| 重新生成 | `bash scripts/build-audit-package.sh` |
| 内容 | 合约源码（trade-finance + supply-chain）、43 个 Anchor 测试、内部审计报告、经济模型、已知风险、部署信息（无私钥） |
| 建议审计重点 | 见包内 `docs/AUDIT-KNOWN-RISKS.md`（DistributeDividends / rebate / LP mint authority / default 保险路径 / u64 边界 / 集中度 / supply-chain 权限） |

> ⚠️ 发送前确认包内**不含**任何 keypair/私钥/生产环境凭据（脚本已自动排除，但请复查）。

## 2. 询价/委托邮件模板

```
主题：Solana 供应链金融合约第三方审计询价（Anchor trade-finance + supply-chain）

尊敬的 [审计机构]：

我们计划对两个 Solana/Anchor（0.31.1 / Agave 4.1.2，SBFv3）合约进行第三方安全审计，
希望获取报价与排期。

- 合约：trade-finance（资金池、订单全生命周期、违约清算、LP 赎回、分红与买方返利）
  + supply-chain（权限化供应商注册）
- 规模：约 2000 行 Rust；43 个 Anchor 集成测试已通过（含资金恒等式/记账增量断言）
- 已有材料：内部审计报告、经济模型说明、已知风险清单、完整测试套件（可打包发送）
- 重点：DistributeDividends、买方返利账本、LP mint authority 链下铸币、
  default 保险路径、u64 边界、集中度限制、权限模型
- 期望交付：漏洞报告（分级）、修复建议、复测确认
- 时间要求：[期望上线时间]

请提供：报价（固定价/按工时）、预计周期、交付物清单、是否支持复测。

附件：audit-package-<日期>.tar.gz（如需）
```

## 3. 发送前核对清单

- [ ] 材料包已重新生成到最新提交（`bash scripts/build-audit-package.sh`）
- [ ] 包内无私钥/凭据（`grep -ri "PRIVATE KEY\\|secret" 解压目录`）
- [ ] 与审计机构签署 NDA（如机构要求）
- [ ] 确认审计范围/交付物/复测条款
- [ ] 拿到报价与排期后回填 [PHASE2-CLOUD-CHECKLIST.md](PHASE2-CLOUD-CHECKLIST.md)

## 4. 审计通过后

1. 按审计报告修复高危/中危（参考 [AUDIT-KNOWN-RISKS.md](AUDIT-KNOWN-RISKS.md) 已列重点）。
2. 修复后重跑：`scripts/build-audit-package.sh` 更新包 → 复测确认 → 更新 CONTRACT-AUDIT.md。
3. 走 [MAINNET-MIGRATION.md](MAINNET-MIGRATION.md)：主网部署（deploy-mainnet.sh）→
   池/Registry 初始化（init-mainnet.sh）→ 小额真实资金灰度。
