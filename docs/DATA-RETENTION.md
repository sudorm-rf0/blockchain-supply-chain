# 数据保留策略

## 默认保留

- `AuditLog`：`AUDIT_RETENTION_DAYS`（默认 90 天），每日 04:00 自动清理。
- `RefreshToken`：30 天有效期；登出/改密后立即吊销。
- `PoolSnapshot`：每小时快照，保留策略由部署方配置（建议 90 天）。
- 文件存证：哈希与 URI 上链后不可删除，链下文件按 `STORAGE_DRIVER` 生命周期策略。

## 用户数据删除（GDPR 风格）

- 删除用户前先吊销所有 refresh token、清空 Redis 缓存键。
- 链上存证（TradeDeal/DocumentRecord）不可删除；应对外披露链上不可篡改属性，
  并以脱敏方式处理链下可删除数据。
- 对象存储中的文件按用户删除时同步移除，除非存在法规保留要求。

## 备份

- 备份保留 7 天（CronJob）；生产建议同步到对象存储并加密
  （`BACKUP_ENCRYPT_KEY`）。
