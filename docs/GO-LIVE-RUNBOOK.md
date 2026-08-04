# 上线 Runbook（人工操作清单）

以下操作必须由有权限的人完成，顺序执行。代码与脚本已就绪。

## 0. 准备账号与资源

- [ ] 云厂商账号 + 可用的 Kubernetes 集群（EKS/GKE/AKS/ACK 等）。
- [ ] 正式域名并完成 DNS 指向；准备 TLS 证书（云证书或 Cert-Manager）。
- [ ] 正式 Solana RPC（Helius/QuickNode），拿到 API Key。
- [ ] `bash scripts/check-rpc.sh "https://<网络>.helius-rpc.com/?api-key=<KEY>"`
      返回 `rpc healthy`（devnet 偶发 SSL 抖动会自动重试 3 次）。
- [ ] 在 GitHub 仓库 Settings -> Secrets and variables -> Actions 中新增
      `SOLANA_RPC_URL`（值填 RPC URL）。CI 的 `frontend-e2e` 会用该 Secret
      做真实 RPC 健康检查，并在后端服务启动时注入；未配置时自动跳过。
- [ ] S3/OSS Bucket（含读写权限的 AccessKey）。
- [ ] 告警渠道：用 `scripts/configure-alertmanager-webhook.sh` 接入
      钉钉/企业微信/Slack/SMTP，并确认 Prometheus -> Alertmanager 联通。
- [ ] 前端构建时确认 `NEXT_PUBLIC_BACKEND_URL` 正确，CSP `report-uri`
      自动指向 `{BACKEND_URL}/api/csp-report`，违规会上报 `csp_violations_total`。
- [ ] 第三方合约审计机构（走合同与排期）。
- [ ] 业务所需 KYC/AML/隐私合规评审。

## 1. 密钥

```bash
# 开发/部署钱包（devnet 可以，主网用独立冷钱包）
solana-keygen new -o ~/.config/solana/id.json
solana config set --url https://api.devnet.solana.com
solana airdrop 2 <你的地址>
```

- [ ] 主网部署钱包与 upgrade authority 私钥离线保管。
- [ ] `JWT_SECRET` 用 `openssl rand -hex 32` 生成，不提交 Git。
- [ ] 数据库、Redis、S3 凭据由云 Secrets/Vault 管理。

## 2. 合约 devnet

```bash
scripts/deploy-devnet.sh
```

部署后人工验证：`initialize_pool` → `deposit_pool` → `create_deal` →
`fund_deal` → `advance_deal` → `repay_deal`，并用索引器确认 DB 同步。
确认 USDC/LP Mint 为 devnet 正式地址（不是本地测试地址）。

⚠️ 新版 `supply-chain` 采用权限化注册：必须先初始化注册中心并授权供应商，
否则任何账户（含管理员）都无法注册商品：

```bash
node scripts/init-supply-chain.mjs <供应商公钥...>
```

脚本幂等（Registry/供应商已存在则跳过），输出 `REGISTRY_ADMIN` 与
`AUTHORIZED_SUPPLIERS` 供核对；撤销供应商用链上 `revoke_supplier`。

## 3. 基础设施

```bash
# 1) 创建命名空间与全部 Secret
NAMESPACE=supply-chain \
ALLOWED_ORIGIN=https://your-domain \
SOLANA_RPC_URL=https://api.devnet.solana.com \
RISK_WEBHOOK_URL=https://risk.example.com/hook \
scripts/create-k8s-secrets.sh

# 2) 构建并推送镜像（或交给 CI）
REGISTRY=your-registry/supply-chain \
PUBLIC_BASE_URL=https://your-domain \
scripts/deploy.sh

# 3) 数据库迁移
kubectl exec deployment/backend -n supply-chain -- npm run prisma:deploy
```

- [ ] Ingress 域名/TLS 已配置并自动续期。
- [ ] 前端构建时 `NEXT_PUBLIC_BACKEND_URL` 等指向正式域名 `/api`。
- [ ] `STORAGE_DRIVER=s3`、`S3_BUCKET`、`S3_REGION`（MinIO 加
      `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE=true`）已注入。
- [ ] 默认管理员密码已更换（当前 seed 默认 `Admin123!` 只用于本地）。

## 4. 上线校验

- [ ] `curl https://your-domain/health` 返回 `db: "up"`。
- [ ] `curl https://your-domain/health/ready` 返回 200。
- [ ] Prometheus 抓取 `/metrics` 正常，告警规则生效。
- [ ] 真实验证一次：上传 → 预览 → 删除；钱包签名存证上链。
- [ ] 用正式 RPC 压测 `POST /api/trades`，确认配额充足。
- [ ] Postgres 做一次真实备份恢复演练；确认备份 CronJob 已创建。
- [ ] CI 全绿；保留上一版镜像用于回滚。

## 5. 主网（上线当天）

- [ ] 审计报告通过，缺陷已修复并复测。
- [ ] 主网部署钱包有足够 SOL。
- [ ] 部署合约后冻结 upgrade authority（或按治理计划保留）。
- [ ] 切 `SOLANA_RPC_URL`、`USDC_MINT`、`LP_MINT` 为主网值。
- [ ] 观察 30 分钟：监控、告警、索引器同步、交易成功率。

## 回滚预案

- 保留上一版镜像 tag；`kubectl rollout undo deployment/backend`。
- 数据库迁移前先备份；破坏性迁移需先降级演练。
- 合约若已冻结升级权限，回滚只影响链下服务，不能覆盖链上状态。

## 上线判定标准（全部满足才算可上线）

- [ ] Runbook 第 0-5 节全部完成。
- [ ] 第三方审计通过且高危/中危缺陷已修复并复测。
- [ ] 真实 K8s 集群完成一次全链路冒烟（注册→上传→存证→建单→拨款→推进→还款）。
- [ ] 生产 RPC 配额压测通过；S3/OSS 上传下载实测通过。
- [ ] Prometheus/告警连续运行 30 分钟无新增告警。
- [ ] 数据库备份恢复演练成功；回滚演练成功。
- [ ] 默认管理员密码已更换；运营账号权限已收敛。
- [ ] 涉及真实资金/用户时，合规评审（KYC/AML/隐私）已完成并归档。

注意：任何一项不满足都意味着上线存在未验证风险；尤其审计不通过或真实集群
冒烟失败时，应回到代码修改流程，而不是继续部署。
