# Deployment Guide

## 1. Architecture and Ports

| Component | Port | Purpose |
| --- | --- | --- |
| Main backend | 3001 | Auth, files, review, audit |
| indexer-service | 3003 | On-chain account watcher + BullMQ persistence |
| trade-service | 3004 | Trade prebuild / confirmation |
| pool-service | 3005 | Pool overview, LP withdrawal / redeem |
| Frontend | 3000/3100 | Next.js admin console |
| Postgres | 5432 | Database `supply_chain` |
| Redis | 6380 (container 6379) | Cache / queue / locks / rate limits |
| Solana localnet | 8899 | Local test chain |

## 2. Local Deployment

Infrastructure:

```bash
docker compose up -d
```

The `solana-localnet` image builds Agave 4.1.2 on first start (downloads the
official release). Agave 4.x only publishes x86_64 Linux packages, so the
service is pinned to `linux/amd64`; on Apple Silicon it runs under Docker
emulation for local development only.

Initialize the database:

```bash
cd packages/backend
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

Build and deploy contracts to localnet (Anchor 0.31.1 + Agave 4.1.2; `solana`
is under `~/.local/share/solana/active_release/bin`):

```bash
cd packages/contracts
anchor build
cargo build-sbf --arch v3
PATH="$HOME/.local/share/solana/active_release/bin:$PATH" solana program deploy \
  target/deploy/trade_finance.so --program-id target/deploy/trade_finance-keypair.json
PATH="$HOME/.local/share/solana/active_release/bin:$PATH" solana program deploy \
  target/deploy/supply_chain.so --program-id target/deploy/supply_chain-keypair.json
```

Initialize the pool and token mints:

```bash
node scripts/init-localnet.mjs
```

The script prints `USDC_MINT` / `LP_MINT` / `ADMIN`. Start services with those
values:

```bash
cd packages/backend
pnpm dev              # 3001
REDIS_URL=redis://localhost:6380 pnpm dev:indexer   # 3003
USDC_MINT=<mint> LP_MINT=<mint> pnpm dev:trade       # 3004
USDC_MINT=<mint> LP_MINT=<mint> REDIS_URL=redis://localhost:6380 pnpm dev:pool # 3005
```

Frontend:

```bash
cd packages/frontend
FRONTEND_PORT=3100 pnpm dev
```

## 3. Image Build

`Dockerfile.multistage` exposes `backend-runner` and `frontend-runner`.
`NEXT_PUBLIC_*` are build-time variables and must be passed at build time:

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
```

## 4. Contract Deployment (devnet)

Configure a real devnet RPC (Helius/QuickNode):

```bash
cp infra/config/rpc.devnet.env.example infra/config/rpc.devnet.env
# Edit infra/config/rpc.devnet.env and set SOLANA_RPC_URL=<real RPC>
bash scripts/check-rpc.sh "$(grep '^SOLANA_RPC_URL=' infra/config/rpc.devnet.env | cut -d= -f2-)"
```

Secrets stay in a local gitignored file and are never committed.

```bash
solana-keygen new -o ~/.config/solana/id.json   # first time
solana airdrop 2 $(solana address)              # if devnet SOL is missing
bash scripts/deploy-devnet.sh
```

The script reads `infra/config/rpc.devnet.env` (or `SOLANA_RPC_URL`), runs
`anchor build && cargo build-sbf --arch v3`, then deploys with the pinned
program keypairs. Third-party contract audit is required before production,
and these Program IDs must be verified:

- `trade_finance`: `9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3`
- `supply_chain`: `Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk`

## 5. Kubernetes Deployment

### 5.1 Secrets

```bash
kubectl create namespace supply-chain
NAMESPACE=supply-chain \
ALLOWED_ORIGIN=https://your-domain \
SOLANA_RPC_URL=https://api.devnet.solana.com \
RISK_WEBHOOK_URL=https://risk.example.com/hook \
bash scripts/create-k8s-secrets.sh
```

The script generates a random `JWT_SECRET` and Redis/Postgres passwords into
`backend-secrets`. Never commit production secrets.

### 5.2 One-click deploy

```bash
NAMESPACE=supply-chain \
REGISTRY=your-registry/supply-chain \
TAG=latest \
PUBLIC_BASE_URL=https://your-domain \
bash scripts/deploy.sh
```

Flow:

1. Build and push backend/frontend images.
2. Create the namespace and validate `backend-secrets`.
3. Apply Postgres, Redis, 5 Deployments, Ingress, backup CronJobs.
4. Wait for all rollouts.
5. Run `prisma migrate deploy`.
6. Rolling-restart the main backend.

Skip build or migration:

```bash
SKIP_BUILD=1 SKIP_MIGRATE=1 bash scripts/deploy.sh
```

Also deploy Prometheus / Grafana / Alertmanager and the backup drill CronJob:

```bash
DEPLOY_MONITORING=1 bash scripts/deploy.sh
```

Monitoring ConfigMaps are generated from `infra/prometheus` and
`infra/grafana` to avoid drift; `postgres-backup-drill-cronjob.yaml` runs a
restore drill on the 1st of each month at 04:00 and verifies every table.

### 5.3 Manifests

- `postgres-statefulset.yaml`, `redis-deployment.yaml`
- `backend-deployment.yaml` / `backend-service.yaml`
- `trade-deployment.yaml`, `pool-deployment.yaml`, `indexer-deployment.yaml`
- `frontend-deployment.yaml`
- `ingress.yaml` (TLS references the `supply-chain-tls` Secret)
- `postgres-backup-cronjob.yaml` (daily 02:00 `pg_dump -Fc`, 7-day retention)
- `postgres-backup-drill-cronjob.yaml` (monthly restore drill)
- `prometheus-deployment.yaml` / `grafana-deployment.yaml` /
  `alertmanager-deployment.yaml` (applied with `DEPLOY_MONITORING=1`)

## 6. Database Migration and Backup

```bash
kubectl exec deployment/backend -n supply-chain -- npm run prisma:deploy
```

Manual backup/restore: `scripts/db-backup-restore.sh`. In production, sync
backups to object storage and run periodic restore drills.

## 7. TLS

The Ingress references the `supply-chain-tls` Secret. Use
`scripts/generate-tls-certs.sh` for self-signed certs or Cert-Manager. Remove
the `tls` block only for plain-HTTP debugging.

## 8. Security Checklist

Verify these variables before production:

| Variable | Requirement |
| --- | --- |
| `JWT_SECRET` | >= 32 chars in production, identical across services |
| `ALLOWED_ORIGIN` | Real domain; cross-origin writes with other Origins get 403 |
| `SOLANA_RPC_URL` | Never localhost in production |
| `USDC_MINT` / `LP_MINT` | Real tokens |
| `THROTTLE_LIMIT` | Evaluate per business; default 120/min/IP |
| `MAX_UPLOADS_PER_DAY` | Default 200 per user per day |
| `STORAGE_DRIVER` | `s3` recommended in production |
| `SENTRY_DSN` | Auto-report 500s when configured |
| `CLAMAV_HOST` / `SCAN_URL` | Virus scan on upload (clamd TCP first, HTTP fallback) |
| `RISK_WEBHOOK_URL` | Defaulted-deal notification endpoint |

## 9. Deployment Verification

```bash
for p in 3001 3003 3004 3005; do curl -sf http://localhost:$p/health; done
curl -sf http://localhost:3003/api/indexer/status
curl -sf http://localhost:3005/api/pool/overview
```

Full-chain smoke:

```bash
USDC_MINT=<mint> LP_MINT=<mint> node scripts/smoke-e2e.mjs
```

CI covers backend Jest, frontend build, Anchor contract tests, and
`scripts/ci-e2e.sh` end-to-end.

## 10. Rollback

```bash
kubectl rollout undo deployment/backend -n supply-chain
kubectl rollout undo deployment/trade-service -n supply-chain
kubectl rollout undo deployment/pool-service -n supply-chain
kubectl rollout undo deployment/indexer-service -n supply-chain
kubectl rollout undo deployment/frontend -n supply-chain
```

Back up the database before migrations; `prisma migrate deploy` cannot be
rolled back, so write compensating SQL when needed.
