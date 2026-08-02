# 运行环境配置与运维

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `s3` 时启用对象存储 |
| `S3_BUCKET` / `S3_REGION` | `supply-chain-files` / `us-east-1` | 对象存储 Bucket |
| `S3_ENDPOINT` | 空 | MinIO 等兼容端点 |
| `S3_FORCE_PATH_STYLE` | `false` | MinIO 必须 `true` |
| `THROTTLE_LIMIT` | `120` | 每分钟请求上限 |
| `JWT_SECRET` | dev 固定值 | 生产必须设置，且所有服务一致 |
| `SOLANA_RPC_URL` | `http://localhost:8899` | 正式 RPC 端点 |
| `LP_MINT` / `USDC_MINT` | dev 占位 | 生产必须替换为正式代币 |
| `RISK_WEBHOOK_URL` | 空 | 违约事件通知地址 |
| `ALLOWED_ORIGIN` | 空 | 生产 CORS 白名单 |

## 可观测性

- 主后端 `/metrics` 暴露 Prometheus 指标（HTTP 请求量、延迟、Node 默认指标）。
- 主后端 `/health` 返回服务与数据库状态；`/health/ready` 供 K8s readiness 使用，
  数据库不可用时返回 503。
- indexer `/api/indexer/status` 返回队列深度与最近同步时间。

建议接入：Prometheus + Grafana（`/metrics`），Sentry 收集后端异常，日志收集
统一走 stdout JSON。

## 文件存储

本地默认写入 `packages/backend/uploads`。生产设置 `STORAGE_DRIVER=s3` 后，
上传文件写入 S3/OSS，数据库只保存对象 key；预览与下载通过鉴权接口流式返回。
MinIO 本地模拟：

```bash
docker run -d -p 9000:9000 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio123 \
  minio/minio server /data
STORAGE_DRIVER=s3 S3_ENDPOINT=http://localhost:9000 S3_FORCE_PATH_STYLE=true \
S3_BUCKET=supply-chain-files pnpm --filter @supply-chain/backend start
```

## 部署顺序

1. `scripts/deploy-devnet.sh` 部署并验证合约。
2. `scripts/create-k8s-secrets.sh` 注入全部密钥。
3. `scripts/deploy.sh` 构建镜像并滚动发布。
4. 打开 Prometheus 抓取 `/metrics`，配置告警。
