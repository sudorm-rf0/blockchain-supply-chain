# Production deployment on 2 VPS (low-traffic setup)

Designed for low daily volume (e.g. single-digit trades/day): **over 80% cheaper than K8s and an order of magnitude simpler to operate**.
The two VPS nodes are split as "app node + data node":

| Node | Runs | Recommended spec |
|---|---|---|
| **VPS-A app node** | Nginx(TLS) + frontend + main backend + trade + pool + indexer + ClamAV | 2C4G / 60GB SSD |
| **VPS-B data node** | Postgres + Redis(AOF) + daily backups | 2C4G / 80GB SSD |

Monthly cost is roughly ¥150~250 (lightweight 2C4G servers run about ¥60-100 each). Solana traffic goes through an external RPC provider (Helius/QuickNode); no chain node runs on the VPS.

> 📌 **Server registry**: provisioned VPS and network details (IP/gateway/owner) are recorded in
> [`docs/VPS-INVENTORY.md`](../../docs/VPS-INVENTORY.md). One node is registered so far (Hong Kong
> `103.39.79.7`, treated as VPS-A app node by default); VPS-B data node is still pending.

## 1. VPS-B (data node, deploy first)

```bash
cd deploy/vps
cp .env.data.example .env.data
vim .env.data                    # set Postgres/Redis passwords
docker compose --env-file .env.data -f data-compose.yml up -d
docker compose --env-file .env.data -f data-compose.yml ps   # postgres/redis/backup all healthy
```

Security notes:
- In the cloud firewall, **restrict ports 5432/6379 to VPS-A's IP only**; no public access.
- The backup container runs `pg_dump -Fc` into `/backups` daily at 02:00, retaining 7 days (`BACKUP_RETENTION_DAYS`).
- Also `rsync /backups` to VPS-A or object storage to keep an offsite copy.

## 2. VPS-A (app node)

```bash
# 1) Upload the code (or git clone)
git clone git@github.com:sudorm-rf0/blockchain-supply-chain.git && cd blockchain-supply-chain

# 2) Configure
cp deploy/vps/.env.app.example deploy/vps/.env.app
vim deploy/vps/.env.app
# Required changes: PUBLIC_BASE_URL, DATABASE_URL/REDIS_URL (point to VPS-B private IP),
#       JWT_SECRET, WEBHOOK_SECRET, ADMIN_PASSWORD, USDC_MINT/LP_MINT,
#       SOLANA_RPC_URL, ALLOWED_ORIGIN

# 3) One-command deploy (build images + start + migrate; ~5-10 minutes on first run)
bash scripts/deploy-vps.sh --seed

# 4) TLS certificate (Let's Encrypt, pick one)
#    Option A: manual certbot issue
#    apt install -y certbot && certbot certonly --standalone -d <domain> --agree-tos -m you@example.com
#    Option B: certbot container (recommended, auto-renew)
#    docker run -d --name certbot --restart unless-stopped -v /etc/letsencrypt:/etc/letsencrypt \
#      -v /var/www/certbot:/var/www/certbot -p 80:80 certbot/certbot \
#      certonly --webroot -w /var/www/certbot -d <domain> --agree-tos -m you@example.com
#    Then replace every occurrence of supply-chain.example.com in nginx.conf with your domain

# 5) DNS: point the domain A record at VPS-A's public IP
```

## 3. Verification

```bash
curl -s https://<domain>/health          # {"status":"ok",...,"db":"up"}
curl -s https://<domain>/health/ready    # 200
curl -s https://<domain>/api/indexer/status   # 0 failed in queue
# Open https://<domain> in a browser and log in as admin
```

## 4. Upgrade and rollback

```bash
# Upgrade: re-build after git pull (NEXT_PUBLIC_* are build-time vars; changing domain/API requires a rebuild)
bash scripts/deploy-vps.sh

# Rollback: keep the previous image tag and switch back to it
docker compose -f deploy/vps/app-compose.yml stop backend
# Or restart the old container directly (docker compose reuses the local image with the same name;
# tag the old one before rebuilding to keep it)
```

## 5. Operations

```bash
# Logs
docker compose -f deploy/vps/app-compose.yml logs -f backend
# Restart a single service
docker compose -f deploy/vps/app-compose.yml restart trade
# Manual backup (VPS-B)
docker exec supply-chain-postgres pg_dump -U supply -Fc supply_chain > /backups/manual.dump
# Restore drill: see scripts/db-backup-restore.sh (point CONTAINER at the VPS-B container)
```

## 6. Known limits (same as the K8s version)

- Both the app node and the data node are single points of failure: rely on Docker `restart: unless-stopped` plus daily backups.
- Database migrations cannot be rolled back automatically: take a manual backup before migrating.
- Files are stored on a local VPS-A volume (`uploads`) by default; switch to `STORAGE_DRIVER=s3` (MinIO/OSS) when volume grows.
- Go-live criteria match [GO-LIVE-RUNBOOK.md](../../docs/GO-LIVE-RUNBOOK.md): audit first, then a small-scale canary.
