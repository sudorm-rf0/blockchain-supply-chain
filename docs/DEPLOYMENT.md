# 部署手册

## 1. 架构与端口

| 组件 | 端口 | 说明 |
| --- | --- | --- |
| 主后端 | 3001 | 认证、文件、审核、审计 |
| indexer-service | 3003 | 链上账户监听 + BullMQ 入库 |
| trade-service | 3004 | 订单预构建/确认 |
| pool-service | 3005 | 资金池总览、LP 提款/赎回 |
| 前端 | 3000/3100 | Next.js 管理台 |
| Postgres | 5432 | 业务库 `supply_chain` |
| Redis | 6380（容器内 6379） | 缓存/队列/锁/限流 |
| Solana localnet | 8899 | 本地测试链 |

## 2. 本地部署

基础设施：

```bash
docker compose up -d
```

`solana-localnet` 会在首次启动时构建 Agave 4.1.2 镜像（需要网络下载
官方发布包）。Agave 4.x 只提供 x86_64 Linux 包，因此该服务固定使用
`linux/amd64`；Apple Silicon 上会通过 Docker 模拟运行，仅用于本地开发。

数据库初始化：

```bash
cd packages/backend
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

合约构建并部署到 localnet（Anchor 0.31.1 + Agave 4.1.2，`solana` 在
`~/.local/share/solana/active_release/bin`）：

```bash
cd packages/contracts
anchor build
cargo build-sbf --arch v3
PATH="$HOME/.local/share/solana/active_release/bin:$PATH" solana program deploy \
  target/deploy/trade_finance.so --program-id target/deploy/trade_finance-keypair.json
PATH="$HOME/.local/share/solana/active_release/bin:$PATH" solana program deploy \
  target/deploy/supply_chain.so --program-id target/deploy/supply_chain-keypair.json
```

初始化资金池与代币：

```bash
node scripts/init-localnet.mjs
```

脚本输出 `USDC_MINT` / `LP_MINT` / `ADMIN`，启动 trade/pool 服务时传入：

```bash
cd packages/backend
pnpm dev              # 3001
REDIS_URL=redis://localhost:6380 pnpm dev:indexer   # 3003
USDC_MINT=<输出> LP_MINT=<输出> pnpm dev:trade       # 3004
USDC_MINT=<输出> LP_MINT=<输出> REDIS_URL=redis://localhost:6380 pnpm dev:pool # 3005
```

前端：

```bash
cd packages/frontend
FRONTEND_PORT=3100 pnpm dev
```

## 3. 镜像构建

`Dockerfile.multistage` 提供 `backend-runner` 与 `frontend-runner` 两个目标。
`NEXT_PUBLIC_*` 是构建期变量，必须在 build 时传入：

```bash
docker build --target backend-runner \
  --build-arg NEXT_PUBLIC_BACKEND_URL=https://your-domain \
  --build-arg NEXT_PUBLIC_TRADE_API_URL=https://your-domain \
  --build-arg NEXT_PUBLIC_POOL_API_URL=https://your-domain \
  -t your-registry/supply-chain-backend:latest .

docker build --target frontend-runner \
  --build-arg NEXT_PUBLIC_BACKEND_URL=https://your-domain \
  --build-arg NEXT_PUBLIC_TRADE_API_URL=https://your-domain \
  --build-arg NEXT_PUBLIC_POOL_API_URL=https://your-domain \
  -t your-registry/supply-chain-frontend:latest .
```

## 4. 合约部署（devnet）

先配置正式 devnet RPC（Helius/QuickNode）：

```bash
cp infra/config/rpc.devnet.env.example infra/config/rpc.devnet.env
# 编辑 infra/config/rpc.devnet.env，填入 SOLANA_RPC_URL=<正式 RPC>
bash scripts/check-rpc.sh "$(grep '^SOLANA_RPC_URL=' infra/config/rpc.devnet.env | cut -d= -f2-)"
```

密钥只保存在本地 gitignored 文件，不会提交到仓库。

```bash
solana-keygen new -o ~/.config/solana/id.json   # 首次
solana airdrop 2 $(solana address)              # 缺少 devnet SOL 时
bash scripts/deploy-devnet.sh
```

脚本会读取 `infra/config/rpc.devnet.env`（或 `SOLANA_RPC_URL`），执行
`anchor build && cargo build-sbf --arch v3`，再用固定的 Program keypair
执行 `solana program deploy`。上线前
必须完成第三方合约审计并核对 Program ID：

- `trade_finance`: `9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3`
- `supply_chain`: `Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk`

部署 `supply_chain` 后，上线前需初始化权限化注册中心并授权真实供应商
（否则任何账户都无法注册商品）：

```bash
node scripts/init-supply-chain.mjs <供应商公钥...>
```

幂等，可重复执行；输出 `REGISTRY_ADMIN` / `AUTHORIZED_SUPPLIERS` 供核对，
详见 [GO-LIVE-RUNBOOK.md](GO-LIVE-RUNBOOK.md) 第 2 节。

## 5. Kubernetes 部署

### 5.1 准备密钥

```bash
kubectl create namespace supply-chain
NAMESPACE=supply-chain \
ALLOWED_ORIGIN=https://your-domain \
SOLANA_RPC_URL=https://api.devnet.solana.com \
RISK_WEBHOOK_URL=https://risk.example.com/hook \
bash scripts/create-k8s-secrets.sh
```

脚本生成随机 `JWT_SECRET`、Redis/Postgres 密码并写入
`backend-secrets`。生产密钥不要提交到 Git。

### 5.2 一键部署

```bash
NAMESPACE=supply-chain \
REGISTRY=your-registry/supply-chain \
TAG=latest \
PUBLIC_BASE_URL=https://your-domain \
bash scripts/deploy.sh
```

流程：

1. 构建并推送 backend/frontend 镜像。
2. 创建命名空间，校验 `backend-secrets` 存在。
3. 应用 Postgres、Redis、5 个 Deployment、Ingress、备份 CronJob。
4. 等待全部 rollout 完成。
5. 执行 `prisma migrate deploy`。
6. 滚动重启主后端。

跳过构建或迁移：

```bash
SKIP_BUILD=1 SKIP_MIGRATE=1 bash scripts/deploy.sh
```

同时部署 Prometheus / Grafana / Alertmanager 与备份演练 CronJob：

```bash
DEPLOY_MONITORING=1 bash scripts/deploy.sh
```

监控 ConfigMap 直接从 `infra/prometheus` 与 `infra/grafana` 生成，避免配置漂移；
`postgres-backup-drill-cronjob.yaml` 每月 1 日 04:00 执行备份恢复到临时库并逐表核对。

### 5.3 清单

- `postgres-statefulset.yaml`、`redis-deployment.yaml`
- `backend-deployment.yaml` / `backend-service.yaml`
- `trade-deployment.yaml`、`pool-deployment.yaml`、`indexer-deployment.yaml`
- `frontend-deployment.yaml`
- `ingress.yaml`（TLS 引用 `supply-chain-tls` Secret）
- `postgres-backup-cronjob.yaml`（每日 02:00 `pg_dump -Fc`，保留 7 天）
- `postgres-backup-drill-cronjob.yaml`（每月 1 日 04:00 一键恢复演练）
- `prometheus-deployment.yaml` / `grafana-deployment.yaml` /
  `alertmanager-deployment.yaml`（`DEPLOY_MONITORING=1` 时应用）

## 6. 数据库迁移与备份

```bash
kubectl exec deployment/backend -n supply-chain -- npm run prisma:deploy
```

手动备份/恢复可参考 `scripts/db-backup-restore.sh`。生产建议把备份同步到
对象存储并定期做恢复演练。

## 7. TLS

Ingress 声明 `supply-chain-tls` Secret。可使用
`scripts/generate-tls-certs.sh` 自签，或接入 Cert-Manager。仅 HTTP 调试时
删除 Ingress 中的 `tls` 段。

## 8. 安全配置清单

上线前必须核对以下环境变量：

| 变量 | 要求 |
| --- | --- |
| `JWT_SECRET` | 生产强制 >= 32 字符，所有服务一致 |
| `ALLOWED_ORIGIN` | 填写真实域名；写请求带非白名单 Origin 会被 403 |
| `SOLANA_RPC_URL` | 生产禁止 localhost，使用正式 RPC |
| `USDC_MINT` / `LP_MINT` | 替换为正式代币 |
| `THROTTLE_LIMIT` | 按业务评估，默认 120 次/分钟/IP |
| `MAX_UPLOADS_PER_DAY` | 默认 200 个/用户/天 |
| `STORAGE_DRIVER` | 生产建议 `s3` |
| `SENTRY_DSN` | 配置后 500 自动上报 |
| `CLAMAV_HOST` / `SCAN_URL` | 配置后上传先杀毒（clamd TCP 优先，HTTP 兜底） |
| `RISK_WEBHOOK_URL` | 违约事件通知地址 |

## 9. 部署验证

```bash
for p in 3001 3003 3004 3005; do curl -sf http://localhost:$p/health; done
curl -sf http://localhost:3003/api/indexer/status
curl -sf http://localhost:3005/api/pool/overview
```

全链路冒烟：

```bash
USDC_MINT=<mint> LP_MINT=<mint> node scripts/smoke-e2e.mjs
```

CI 已覆盖：后端 Jest、前端构建、Anchor 合约测试、`scripts/ci-e2e.sh`
全链路。

## 10. 回滚

```bash
kubectl rollout undo deployment/backend -n supply-chain
kubectl rollout undo deployment/trade-service -n supply-chain
kubectl rollout undo deployment/pool-service -n supply-chain
kubectl rollout undo deployment/indexer-service -n supply-chain
kubectl rollout undo deployment/frontend -n supply-chain
```

数据库迁移建议先备份再执行；`prisma migrate deploy` 不可回滚，需要
按迁移文件编写补偿 SQL。
