# 操作手册

## 1. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 本地 Postgres | Prisma 连接串 |
| `REDIS_URL` | `redis://localhost:6380` | 缓存、队列、锁、防暴破 |
| `SOLANA_RPC_URL` | `http://localhost:8899` | 正式环境必须替换；**支持逗号分隔多个 Key**（如 `https://a.helius...?key=1,https://b...?key=2`，逐个轮询分摊配额/限流） |
| `JWT_SECRET` | dev 固定值 | 生产强制 >= 32 字符 |
| `THROTTLE_LIMIT` | `120` | 每分钟每 IP 上限 |
| `MAX_UPLOADS_PER_DAY` | `200` | 每用户每日上传上限 |
| `ALLOWED_ORIGIN` | 空 | 写请求 Origin 白名单 |
| `STORAGE_DRIVER` | `local` | `s3` 时启用对象存储 |
| `S3_BUCKET` / `S3_REGION` | `supply-chain-files` / `us-east-1` | 对象存储 |
| `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` | 空 / `false` | MinIO 等兼容端点 |
| `TRADE_FINANCE_PROGRAM_ID` | 9c8eND... | 合约 Program ID |
| `USDC_MINT` / `LP_MINT` | dev 占位 | 正式代币 |
| `RISK_WEBHOOK_URL` | 空 | 违约事件通知 |
| `REPAYMENT_NOTIFY_URL` | 空 | 还款到期通知（IM/邮件 Webhook，HMAC 签名同 `WEBHOOK_SECRET`） |
| `WEBHOOK_SECRET` | dev 值 | Webhook HMAC 签名密钥 |
| `SENTRY_DSN` | 空 | 配置后 500 自动上报 |
| `CLAMAV_HOST` / `CLAMAV_PORT` | 空 / 3310 | clamd TCP 杀毒；生产必须配置 |
| `SCAN_URL` | 空 | 备选 HTTP 杀毒服务（`{clean: boolean}`） |
| `AUDIT_RETENTION_DAYS` | `90` | 审计日志保留天数；每天 04:00 自动清理，`0` 表示关闭清理 |
| `NEXT_PUBLIC_CSP_REPORT_URI` | 空 | 显式覆盖 CSP `report-uri`；默认使用 `NEXT_PUBLIC_BACKEND_URL/api/csp-report` |
| `ALERTMANAGER_WEBHOOK_URL` | 空 | Alertmanager 钉钉/企业微信/通用 Webhook 地址 |
| `ALERTMANAGER_SLACK_URL` | 空 | Alertmanager Slack Incoming Webhook 地址 |
| `ALERTMANAGER_EMAIL_TO` / `ALERTMANAGER_SMTP_SMARTHOST` / `ALERTMANAGER_SMTP_FROM` | 空 | Alertmanager SMTP 邮件渠道 |

## 2. 安全运行规则

- 登录限流与锁定：接口 20 次/分钟；同一邮箱失败 5 次或同一 IP 失败
  20 次后锁定 15 分钟。运维可用 `redis-cli del login:fail:<email>`
  手动解锁，不建议在生产开放。
- 跨站防护：写请求（POST/PATCH/DELETE）校验 `Origin`，不在
  `ALLOWED_ORIGIN`/localhost 白名单内返回 403。换域名后必须同步
  更新 `ALLOWED_ORIGIN` 与 Ingress/Secret。
- 上传权限：带 `tradeId` 的上传必须由订单买方/卖方本人执行；同哈希
  同用户不可重复上传；每日配额默认 200。
- 敏感操作二次确认：文件审核、文件删除、提款执行必须携带
  `confirm=true`，前端弹窗与后端校验共同生效。
- 请求日志：4xx/5xx 全量记录，2xx/3xx 抽样 1%，防止高流量下日志洪峰。

## 3. 日常巡检

```bash
# 健康检查（四个服务）
for p in 3001 3003 3004 3005; do curl -sf http://localhost:$p/health; done

# 索引器同步状态：队列积压、最近快照、订单总数
curl -sf http://localhost:3003/api/indexer/status

# Prometheus 指标
curl -sf http://localhost:3001/metrics
```

重点观察：

- `queue.failed > 0`：进入 BullMQ 失败任务，查看 indexer 日志。
- `lastPoolSnapshotAt` 超过 1 小时未更新：链上 RPC 或订阅异常。
- `lastDealSyncedAt` 长时间不变：确认 localnet/devnet 是否有新交易。
- 审计日志：`GET /api/admin/audit-logs`，前端 `/admin/audit`。
  敏感操作均已落审计：注册/登录/登出/改密/绑定钱包、文件上传/审核/驳回/删除/
  存证、订单创建/拨款/推进/还款/违约/释放、提款申请/执行、LP 赎回、还款到期。

## 4. 文件存储

本地默认写入 `packages/backend/uploads`。生产设置 `STORAGE_DRIVER=s3`：

```bash
STORAGE_DRIVER=s3 \
S3_BUCKET=supply-chain-files \
S3_REGION=us-east-1 \
S3_ENDPOINT=https://minio.example.com \
S3_FORCE_PATH_STYLE=true \
pnpm --filter @supply-chain/backend start
```

数据库只保存对象 key；预览与下载通过鉴权接口流式返回。S3 建议开启
版本控制与生命周期策略。

## 5. 数据库备份与恢复

一键备份恢复演练（备份 -> 临时库恢复 -> 逐表核对 -> JSON 报告）：

```bash
bash scripts/db-backup-restore.sh drill
```

只备份：`bash scripts/db-backup-restore.sh backup`
用已有 dump 验证：`bash scripts/db-backup-restore.sh restore <备份文件>`

监控与告警验证：

```bash
bash scripts/verify-monitoring.sh
```

部署后一键验证（健康/就绪/指标/关键接口，可选全链路冒烟）：

```bash
bash scripts/verify-deployment.sh
bash scripts/verify-contract-deployment.sh
```

详见 [docs/MONITORING.md](MONITORING.md)。

### NetworkPolicy 外部出口收紧密级

默认 `k8s/network-policies.yaml` 的外部出口为 `0.0.0.0/0` 兜底宽放。上线前
按用途收紧密级：

```bash
cp infra/config/network-policy.env.example infra/config/network-policy.env
# 编辑 infra/config/network-policy.env，填入实际 CIDR
set -a; source infra/config/network-policy.env; set +a
bash scripts/generate-network-policies.sh
kubectl apply -f k8s/network-policies.generated.yaml -n supply-chain
```

生成后删除 `k8s/network-policies.yaml` 中的宽放段（`allow-egress-external`），
实现最小化出口。三个用途可分别配置：`SOLANA_RPC_CIDR`、
`RISK_WEBHOOK_CIDR`、`S3_CIDR`；未配置的用途保持宽放。

K8s 环境每天 02:00 自动 `pg_dump -Fc` 到 `postgres-backups` PVC，保留
7 天。生产必须把备份同步到对象存储并每季度做恢复演练。

## 6. 常见故障处理

### Redis 不可用

- 登录锁定、文件缓存、提款锁静默降级（返回 0/空），功能不中断但
  防暴破失效，应立即恢复 Redis。
- `docker compose restart redis` 或 `kubectl rollout restart deployment/redis`。

### 数据库不可用

- `/health/ready` 返回 503，K8s 会摘除流量。
- 检查 `DATABASE_URL`、连接数（`connection_limit`）、磁盘空间。

### RPC / 索引器不同步

- 确认 `SOLANA_RPC_URL` 可达，`solana cluster-version` 正常。
- 重启 indexer 会触发一次全量 fallback 快照。
- 若 `queue.failed` 增加，查看失败原因；默认 BullMQ 会重试。

### 大量 429

- 检查 `THROTTLE_LIMIT`、登录锁定计数（`redis-cli keys 'login:fail:*'`）。
- 对正常客户端可提高 `THROTTLE_LIMIT`，或为读接口加缓存/放宽限流。

### 大量 403 跨域

- 核对 `ALLOWED_ORIGIN` 与前端实际 Origin，修改后重启服务。

### 文件上传 400/409/429

- 400：扩展名/魔数不匹配、tradeId 不属于当前用户。
- 409：同哈希重复上传。
- 429：每日配额超限，检查 `MAX_UPLOADS_PER_DAY`。

### 本地病毒扫描

病毒扫描默认 fail-closed：无 `CLAMAV_HOST` / `SCAN_URL` 时上传会被拒绝。
生产必须配置真实 ClamAV 或云扫描。本地开发默认使用
`docker compose --profile security up -d clamav`（镜像自带病毒库），后端设
`CLAMAV_HOST=localhost`。仅在无法运行 Docker ClamAV 的环境显式使用 stub 放行：

```bash
PORT=3311 node scripts/dev-scan-stub.mjs   # 或由 scripts/dev-all.sh 自动启动
```

并设置 `SCAN_URL=http://localhost:3311/scan`。生产禁止使用 stub。

存量文件批量核查（历史上传未经过杀毒、或上线前复核）：

```bash
node scripts/scan-uploads.mjs            # 默认扫描 packages/backend/uploads
node scripts/scan-uploads.mjs <目录>     # 指定其他目录
```

脚本通过 clamd INSTREAM（TCP）逐文件扫描，输出 `clean/found/sizelimit/error` 统计，
存在病毒或错误时退出码为 1 并列出问题文件。

## 7. 合约运维

- 重新部署合约：`bash scripts/deploy-devnet.sh`（devnet）或 localnet
  `cargo build-sbf --arch v3 && solana program deploy --program-id <keypair> target/deploy/*.so`。
- 初始化资金池：`node scripts/init-localnet.mjs`，输出
  `USDC_MINT` / `LP_MINT` / `ADMIN`。
- supply-chain 权限化注册：`node scripts/init-supply-chain.mjs <供应商公钥...>`
  初始化 Registry 并授权供应商（幂等）；管理端「供应链管理」页
  （`/admin/supply-chain`）可完成初始化/授权/撤销/注册商品（钱包签名）。
- 违约事件会调用 `RISK_WEBHOOK_URL`，签名头
  `x-webhook-signature`（HMAC-SHA256）与 `x-webhook-timestamp`。
- 合约升级后必须重新生成 Prisma 无关、更新 Indexer 解析器并跑
  `cd packages/contracts && pnpm test`。

## 8. 上线清单

见 [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) 与
[GO-LIVE-RUNBOOK.md](GO-LIVE-RUNBOOK.md)。
