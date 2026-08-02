# 部署手册

## 1. 准备镜像

```bash
docker build --target backend-runner \
  --build-arg NEXT_PUBLIC_BACKEND_URL=https://your-domain/api \
  --build-arg NEXT_PUBLIC_TRADE_API_URL=https://your-domain/api \
  --build-arg NEXT_PUBLIC_POOL_API_URL=https://your-domain/api \
  -t your-registry/supply-chain-backend:latest .
docker build --target frontend-runner \
  --build-arg NEXT_PUBLIC_BACKEND_URL=https://your-domain/api \
  --build-arg NEXT_PUBLIC_TRADE_API_URL=https://your-domain/api \
  --build-arg NEXT_PUBLIC_POOL_API_URL=https://your-domain/api \
  -t your-registry/supply-chain-frontend:latest .
docker push your-registry/supply-chain-backend:latest
docker push your-registry/supply-chain-frontend:latest
```

`NEXT_PUBLIC_*` 是构建期变量，必须在 build 时传入；运行时注入无效。

## 2. 集群与密钥

```bash
kubectl create namespace supply-chain
NAMESPACE=supply-chain \
ALLOWED_ORIGIN=https://your-domain \
SOLANA_RPC_URL=https://api.devnet.solana.com \
RISK_WEBHOOK_URL=https://risk.example.com/hook \
scripts/create-k8s-secrets.sh
```

脚本会生成随机 `JWT_SECRET`、Redis/Postgres 密码，并把数据库、RPC、合约
Program ID、USDC Mint 写入 `backend-secrets`。生产密钥不要提交到 Git。

## 3. 部署

```bash
NAMESPACE=supply-chain \
REGISTRY=your-registry/supply-chain \
PUBLIC_BASE_URL=https://your-domain \
scripts/deploy.sh
```

流程：构建/推镜像 → 创建命名空间与 Secret 检查 → 应用
Postgres/Redis/5 个 Deployment/Ingress/备份 CronJob → `prisma migrate deploy`
→ 滚动重启。

## 4. 数据库迁移与备份

```bash
kubectl exec deployment/backend -n supply-chain -- npm run prisma:deploy
```

Postgres 每天 02:00 自动 `pg_dump -Fc` 到 `postgres-backups` PVC，保留 7 天。
生产建议额外把备份同步到对象存储（S3/OSS）并做恢复演练。

## 5. TLS

Ingress 已声明 `supply-chain-tls` Secret，域名需与
`scripts/generate-tls-certs.sh` 或 Cert-Manager 保持一致。仅 HTTP 时先删除
Ingress 中的 `tls` 段。
