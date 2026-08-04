# Operations Guide

## 1. Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | Prisma connection string |
| `REDIS_URL` | `redis://localhost:6380` | Cache, queue, locks, brute-force protection |
| `SOLANA_RPC_URL` | `http://localhost:8899` | Must be replaced in production |
| `JWT_SECRET` | dev value | >= 32 chars in production |
| `THROTTLE_LIMIT` | `120` | Requests per minute per IP |
| `MAX_UPLOADS_PER_DAY` | `200` | Uploads per user per day |
| `ALLOWED_ORIGIN` | empty | Origin allowlist for write requests |
| `STORAGE_DRIVER` | `local` | `s3` enables object storage |
| `S3_BUCKET` / `S3_REGION` | `supply-chain-files` / `us-east-1` | Object storage |
| `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` | empty / `false` | MinIO-compatible endpoints |
| `TRADE_FINANCE_PROGRAM_ID` | 9c8eND... | Contract Program ID |
| `USDC_MINT` / `LP_MINT` | dev placeholders | Real tokens |
| `RISK_WEBHOOK_URL` | empty | Defaulted-deal notifications |
| `WEBHOOK_SECRET` | dev value | Webhook HMAC signing key |
| `SENTRY_DSN` | empty | Auto-report 500s when configured |
| `CLAMAV_HOST` / `CLAMAV_PORT` | empty / 3310 | clamd TCP scan; required in production |
| `SCAN_URL` | empty | HTTP scan fallback (`{clean: boolean}`) |
| `AUDIT_RETENTION_DAYS` | `90` | Audit retention days; purged daily at 04:00; `0` disables |
| `NEXT_PUBLIC_CSP_REPORT_URI` | empty | CSP `report-uri`; browser sends violations here (defaults to `/api/csp-report`) |

## 2. Security Rules

- Login rate limiting and lockout: 20 requests/min per endpoint; lock for 15
  minutes after 5 failures per email or 20 per IP. Unlock with
  `redis-cli del login:fail:<email>`; do not expose this in production.
- Cross-site protection: write requests (POST/PATCH/DELETE) validate `Origin`;
  origins outside `ALLOWED_ORIGIN`/localhost get 403. Update `ALLOWED_ORIGIN`
  and Ingress/Secret when the domain changes.
- Upload permissions: uploads with a `tradeId` must be performed by the order
  buyer or seller; duplicate hash per user is rejected; daily quota defaults
  to 200.
- Sensitive actions need confirmation: file review, file deletion, and
  withdrawal execution require `confirm=true`; both frontend dialogs and
  backend validation enforce it.
- Request logging: all 4xx/5xx logged; 2xx/3xx sampled at 1% to avoid log
  floods under high traffic.

## 3. Daily Inspection

```bash
# Health (four services)
for p in 3001 3003 3004 3005; do curl -sf http://localhost:$p/health; done

# Indexer sync: queue backlog, latest snapshot, deal count
curl -sf http://localhost:3003/api/indexer/status

# Prometheus metrics
curl -sf http://localhost:3001/metrics
```

Watch for:

- `queue.failed > 0`: BullMQ failed jobs; check indexer logs.
- `lastPoolSnapshotAt` older than 1 hour: RPC or subscription issue.
- `lastDealSyncedAt` unchanged: confirm new transactions on localnet/devnet.
- Audit logs: `GET /api/admin/audit-logs`, UI at `/admin/audit`. All sensitive
  actions are audited: register/login/logout/password change/wallet binding,
  file upload/review/reject/delete/attest, order create/fund/advance/repay/
  default/release, withdrawal request/execute, LP redeem, repayment due.

## 4. File Storage

Local files go to `packages/backend/uploads`. In production set
`STORAGE_DRIVER=s3`:

```bash
STORAGE_DRIVER=s3 \
S3_BUCKET=supply-chain-files \
S3_REGION=us-east-1 \
S3_ENDPOINT=https://minio.example.com \
S3_FORCE_PATH_STYLE=true \
pnpm --filter @supply-chain/backend start
```

Only object keys are stored in the database; preview and download stream
through authenticated endpoints. Enable S3 versioning and lifecycle policies.

## 5. Database Backup and Restore

One-click drill (backup -> restore to temp DB -> verify every table -> JSON
report):

```bash
bash scripts/db-backup-restore.sh drill
```

Backup only: `bash scripts/db-backup-restore.sh backup`
Verify an existing dump: `bash scripts/db-backup-restore.sh restore <file>`

Monitoring verification:

```bash
bash scripts/verify-monitoring.sh
```

See [docs/MONITORING.md](MONITORING.md).

In K8s, `pg_dump -Fc` runs daily at 02:00 into the `postgres-backups` PVC with
7-day retention. Sync backups to object storage and run restore drills
quarterly in production.

## 6. Troubleshooting

### Redis unavailable

- Login lockout, file cache, and withdrawal locks degrade silently (return
  0/empty); features keep working but brute-force protection is disabled.
- `docker compose restart redis` or
  `kubectl rollout restart deployment/redis`.

### Database unavailable

- `/health/ready` returns 503 and K8s removes traffic.
- Check `DATABASE_URL`, connection count (`connection_limit`), and disk space.

### RPC / indexer out of sync

- Confirm `SOLANA_RPC_URL` is reachable and `solana cluster-version` works.
- Restarting the indexer triggers a full fallback snapshot.
- If `queue.failed` grows, inspect failure reasons; BullMQ retries by default.

### Many 429s

- Check `THROTTLE_LIMIT` and login lock counters
  (`redis-cli keys 'login:fail:*'`).
- Raise `THROTTLE_LIMIT` or cache/relax read endpoints for normal clients.

### Many 403 cross-origin errors

- Verify `ALLOWED_ORIGIN` matches the frontend Origin; restart after changes.

### Upload 400/409/429

- 400: extension/magic mismatch, or `tradeId` not owned by the user.
- 409: duplicate hash re-upload.
- 429: daily quota exceeded; check `MAX_UPLOADS_PER_DAY`.

## 7. Contract Operations

- Redeploy contracts: `bash scripts/deploy-devnet.sh` (devnet), or localnet
  `cargo build-sbf --arch v3 && solana program deploy --program-id <keypair> target/deploy/*.so`.
- Initialize the pool: `node scripts/init-localnet.mjs`, which prints
  `USDC_MINT` / `LP_MINT` / `ADMIN`.
- Defaulted deals call `RISK_WEBHOOK_URL` with `x-webhook-signature`
  (HMAC-SHA256) and `x-webhook-timestamp`.
- After a contract upgrade, update the indexer parsers and run
  `cd packages/contracts && pnpm test`.

## 8. Launch Checklist

See [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) and
[GO-LIVE-RUNBOOK.md](GO-LIVE-RUNBOOK.md).
