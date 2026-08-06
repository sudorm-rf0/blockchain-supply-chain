# Phase 2 云资源清单（真实上线前置）

本清单对应 [GO-LIVE-RUNBOOK.md](GO-LIVE-RUNBOOK.md) 第 0-5 节，按"今天就能免费准备"和
"需要付费/外部资源"分组。**低使用量场景建议走 2-VPS 方案**（`deploy/vps/`，月成本约
¥150-250），K8s 仅在需要弹性伸缩时选择。

## 一、今天就能免费准备（不需要花钱）

| 项 | 做什么 | 结果 |
|---|---|---|
| 代码与 CI | 全部已在 `main`，CI 全绿（含 `vps-deploy` 校验） | ✅ |
| 部署套件 | `deploy/vps/`（app+data compose、nginx、deploy-vps.sh --rehearsal） | ✅ 已提交 |
| 合约 | devnet 已部署 + 39 anchor 测试；审计范围建议见 CONTRACT-AUDIT.md | ✅ |
| 冒烟 | `scripts/smoke-e2e.mjs` devnet 6/6 + CI localnet e2e | ✅ |
| 监控验证 | `scripts/verify-monitoring.sh`（promtool + 大盘 JSON） | ✅ |
| 密钥生成 | `openssl rand -hex 32` 生成 JWT_SECRET / WEBHOOK_SECRET | 部署时用 |
| 域名预注册 | 阿里云/腾讯云 `.com` 约 ¥50-80/年；先注册并完成 ICP 备案（国内服务器必需，约 1-3 周） | ⏳ 尽早启动 |
| 审计机构询价 | 联系 Solana 审计机构（OtterSec/Neodyme/Halborn 或国内机构）拿报价与排期 | ⏳ 尽早启动 |

## 二、需要付费/外部资源（按优先级）

| 优先级 | 项 | 选项 | 预估成本 | 说明 |
|---|---|---|---|---|
| P0 | **第三方合约审计** | 专业审计机构 | 数千~数万美元（不含在内测成本估算） | 涉及资金托管/分红/返利，必须出报告 |
| P0 | **云服务器** | 2×VPS 2C4G（阿里云/腾讯云轻量） | ¥60-100/台/月 | 应用机 + 数据机；或 1 台 4C8G 起步 |
| P0 | **域名 + TLS** | 阿里云/腾讯云 + Let's Encrypt | ¥5-7/月 | ICP 备案先行 |
| P0 | **正式 Solana RPC** | Helius/QuickNode Developer 档 | ¥0-350/月 | 免费档实测 15-20 RPS、40% 429，不够 |
| P1 | **对象存储** | OSS/S3 或 VPS 自建 MinIO | ¥20-50/月 或 0 | 单据文件；`STORAGE_DRIVER=s3` |
| P1 | **告警渠道** | 钉钉/企业微信/Slack/SMTP | ¥0 | `scripts/configure-alertmanager-webhook.sh` |
| P1 | **Sentry** | Sentry SaaS/自建 | ¥0-100/月 | 配 `SENTRY_DSN` |
| P1 | **监控** | 自建 Prometheus/Grafana（随 VPS）或云监控 | ¥0 | K8s 版已有 `DEPLOY_MONITORING=1` |
| P2 | **数据库** | 自建 Postgres（随数据机）或云 RDS | ¥0-300/月 | 低用量自建即可，靠备份兜底 |
| P2 | **短信/邮件通知** | 按量 | 按量 | 还款到期/违约通知 |
| P2 | **密钥管理** | 云 Secret Manager/Vault | ¥0-50/月 | 生产密钥不落 VPS 明文 |

## 三、账号与凭据准备（部署当天需要）

1. 云厂商账号 + API 密钥（创建 VPS、安全组）。
2. 域名解析：A 记录 → VPS-A 公网 IP。
3. Helius/QuickNode API Key（`SOLANA_RPC_URL`，可配多个逗号分隔轮询）。
4. OSS/S3 AccessKey（`STORAGE_DRIVER=s3` 时）。
5. 告警 Webhook URL（钉钉机器人/企业微信机器人/Slack）。
6. 部署钱包：主网用独立冷钱包，`upgrade authority` 私钥离线保管；LP mint authority 交多签/治理方。

## 四、验收（对照 GO-LIVE-RUNBOOK 判定标准）

- [ ] 第三方审计通过，高危/中危已修复复测
- [ ] 真实 VPS 全链路冒烟：注册→上传→存证→建单→拨款→推进→还款
- [ ] `deploy-vps.sh` 部署成功，`/health` 返回 `db: "up"`
- [ ] RPC 压测 ≥50 RPS 且 p95 < 500ms（`scripts/load-test/rpc-load-test.mjs`）
- [ ] 备份恢复演练成功（`scripts/db-backup-restore.sh drill`）
- [ ] 监控/告警连续运行 30 分钟无新增告警
- [ ] 管理员已开启 TOTP、默认密码已更换、`ALLOWED_ORIGIN` 为真实域名
- [ ] 合规评审（KYC/AML/隐私/数据跨境）完成并归档

## 五、建议排期

1. **本周**：注册域名 + 启动 ICP 备案；联系审计机构询价。
2. **2 周内**：审计排期确定；RPC 套餐确定；VPS 下单。
3. **审计通过后**：VPS 部署 → 全链路冒烟 → 小额灰度（5-50 万级）→ 观察 30 天 → 放量。
