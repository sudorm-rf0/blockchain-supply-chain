# 2 台 VPS 生产部署（低使用量方案）

适合日交易量小（如个位数/日）的场景：**比 K8s 便宜 80% 以上，运维简单一个量级**。
两台 VPS 采用"应用机 + 数据机"分离：

| 机器 | 跑什么 | 建议配置 |
|---|---|---|
| **VPS-A 应用机** | Nginx(TLS) + 前端 + 主后端 + trade + pool + indexer + ClamAV | 2C4G / 60GB SSD |
| **VPS-B 数据机** | Postgres + Redis(AOF) + 每日备份 | 2C4G / 80GB SSD |

月成本约 ¥150~250（轻量服务器 2C4G 约 ¥60-100/台）。Solana 走外部 RPC（Helius/QuickNode），VPS 不跑链节点。

## 一、VPS-B（数据机，先部署）

```bash
cd deploy/vps
cp .env.data.example .env.data
vim .env.data                    # 改 Postgres/Redis 密码
docker compose --env-file .env.data -f data-compose.yml up -d
docker compose --env-file .env.data -f data-compose.yml ps   # postgres/redis/backup 都 healthy
```

安全要点：
- 云防火墙把 **5432/6379 端口来源限制为仅 VPS-A 的 IP**，禁止公网直连。
- 备份容器每天 02:00 `pg_dump -Fc` 到 `/backups`，保留 7 天（`BACKUP_RETENTION_DAYS`）。
- 建议再 `rsync /backups` 一份到 VPS-A 或对象存储，实现异地副本。

## 二、VPS-A（应用机）

```bash
# 1) 上传代码（或 git clone）
git clone git@github.com:sudorm-rf0/blockchain-supply-chain.git && cd blockchain-supply-chain

# 2) 配置
cp deploy/vps/.env.app.example deploy/vps/.env.app
vim deploy/vps/.env.app
# 必改：PUBLIC_BASE_URL、DATABASE_URL/REDIS_URL（指向 VPS-B 内网 IP）、
#       JWT_SECRET、WEBHOOK_SECRET、ADMIN_PASSWORD、USDC_MINT/LP_MINT、
#       SOLANA_RPC_URL、ALLOWED_ORIGIN

# 3) 一键部署（构建镜像 + 启动 + 迁移；首次约 5-10 分钟）
bash scripts/deploy-vps.sh --seed

# 4) TLS 证书（Let's Encrypt，二选一）
#    方式 A：certbot 手动签发
#    apt install -y certbot && certbot certonly --standalone -d <域名> --agree-tos -m you@example.com
#    方式 B：certbot 容器（推荐，自动续期）
#    docker run -d --name certbot --restart unless-stopped -v /etc/letsencrypt:/etc/letsencrypt \
#      -v /var/www/certbot:/var/www/certbot -p 80:80 certbot/certbot \
#      certonly --webroot -w /var/www/certbot -d <域名> --agree-tos -m you@example.com
#    然后记得把 nginx.conf 里的 supply-chain.example.com 全部替换为你的域名

# 5) DNS：把域名 A 记录指向 VPS-A 公网 IP
```

## 三、验证

```bash
curl -s https://<域名>/health          # {"status":"ok",...,"db":"up"}
curl -s https://<域名>/health/ready    # 200
curl -s https://<域名>/api/indexer/status   # 队列 0 failed
# 浏览器打开 https://<域名>，登录管理员
```

## 四、升级与回滚

```bash
# 升级：git pull 后重新构建（NEXT_PUBLIC_* 是构建期变量，改域名/接口必须重建）
bash scripts/deploy-vps.sh

# 回滚：保留上一版镜像 tag，改回旧镜像
docker compose -f deploy/vps/app-compose.yml stop backend
# 或直接重启旧容器（docker compose 会用本地同名镜像，构建前先 docker tag 保留旧版）
```

## 五、运维

```bash
# 日志
docker compose -f deploy/vps/app-compose.yml logs -f backend
# 重启单个
docker compose -f deploy/vps/app-compose.yml restart trade
# 手动备份（VPS-B）
docker exec supply-chain-postgres pg_dump -U supply -Fc supply_chain > /backups/manual.dump
# 恢复演练：参考 scripts/db-backup-restore.sh（把 CONTAINER 指到 VPS-B 的容器）
```

## 六、已知边界（与 K8s 版一致）

- 应用机/数据机均为单点：依赖 Docker `restart: unless-stopped` + 每日备份兜底。
- 数据库迁移不可自动回滚：迁移前先手动备份。
- 文件默认存 VPS-A 本地卷（`uploads`）；量大了再切 `STORAGE_DRIVER=s3`（MinIO/OSS）。
- 上线判定标准与 [GO-LIVE-RUNBOOK.md](../../docs/GO-LIVE-RUNBOOK.md) 一致：先审计、先小额灰度。
