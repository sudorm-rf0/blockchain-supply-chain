# 应急预案

## 通用原则

- 先止血再定位：优先恢复可用性，随后排查根因并补齐告警/测试。
- 每一步操作都写审计：`AuditLog` 记录 `action`、操作者、目标与时间。
- 升级路径：值班工程师 → 服务负责人 → 合约/资金负责人。
- 每次事故后更新本手册与监控告警，避免同类事故复发。

## 1. 数据库不可用

现象：`/health/ready` 返回 503；接口报连接超时/拒绝。

处置：

1. `kubectl get pods -l app=postgres` 或 `docker ps | grep postgres` 确认实例状态。
2. 查看日志：`kubectl logs <pod> --tail=200` / `docker logs supply-chain-postgres`。
3. 若磁盘满：清理 WAL/旧备份后扩容 PVC。
4. 若连接打满：检查 `connection_limit`、慢查询，必要时重启连接池。
5. 恢复后执行 `bash scripts/db-backup-restore.sh drill` 验证备份仍可用。

## 2. Redis 不可用

现象：登录防暴破、文件缓存、提款锁失效；业务接口仍可返回（已做降级）。

处置：

1. 确认实例：`kubectl rollout status deployment/redis` 或
   `docker compose restart redis`。
2. 检查内存与持久化：`redis-cli info memory`、`AOF` 是否开启。
3. Redis 恢复后验证登录锁定、文件列表缓存、LP 提款锁。

## 3. RPC / 索引器不同步

现象：`/api/indexer/status` 落后；订单状态与链上不一致。

处置：

1. `solana cluster-version --url <RPC>` 确认 RPC 可达且版本兼容。
2. 重启 indexer 触发全量 fallback 快照。
3. 查看 BullMQ `failed` 队列：`redis-cli llen bull:sync-queue:failed`。
4. Webhook 失败时服务已自动重试 3 次，仍失败则检查 `RISK_WEBHOOK_URL`。

## 4. 文件上传异常

现象：400 扩展名/魔数不匹配、409 重复哈希、429 配额、扫描失败。

处置：

1. 400：检查扩展名与真实文件类型是否一致；图片是否被 EXIF 处理失败。
2. 409：同用户同哈希重复上传，前端提示去“我的文件”查看。
3. 429：确认 `MAX_UPLOADS_PER_DAY` 与 Redis 配额键 `upload:quota:*`。
4. 扫描失败：确认 `CLAMAV_HOST` / `SCAN_URL` 可用；失败策略默认拒绝上传。

## 5. 5xx 比例升高

现象：`High5xxRate` 告警触发；`/metrics` 中 `http_requests_total{status=~"5.."}` 上升。

处置：

1. 打开 Prometheus/Grafana 看 P99、内存、事件循环与错误分布。
2. 检查最近发布/迁移记录，必要时回滚 Deployment。
3. 看 Sentry 错误采样，优先修复 Top 3 异常。

## 6. 合约或资金事故（最高优先级）

现象：链上指令失败、资金账本异常、`DEFAULTED` 处理异常。

处置：

1. 立即暂停该合约资金操作入口（前端按钮隐藏 + 后端守卫下线）。
2. 用 `solana program show` 核对 Program ID 与 upgrade authority。
3. 拉取链上账户快照与本地 DB 对账，保留交易签名证据。
4. 涉及资金损失时按预案通知法务/风控并保留取证，禁止擅自补发。
5. 修复后必须走第三方审计再重新部署。

## 7. 备份恢复演练

每月执行一次：

```bash
bash scripts/db-backup-restore.sh drill
```

K8s 环境由 `postgres-backup-drill` CronJob 自动执行；Job 失败即触发告警。
