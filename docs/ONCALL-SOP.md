# 上线值班 SOP（故障处置手册）

配合 [INCIDENT-RUNBOOK.md](INCIDENT-RUNBOOK.md) 使用。**原则：先止损 → 再定位 → 后修复 → 复盘。**

## 0. 告警分级与响应时限

| 级别 | 示例 | 响应时限 | 升级对象 |
|---|---|---|---|
| P0 | 资金池恒等式破坏、数据库丢失、合约异常 | 立即 | 技术负责人 + 业务方 |
| P1 | 服务不可用、indexer 停止、RPC 大面积 429 | 15 分钟 | 值班人 + 备份 |
| P2 | 单笔订单状态不一致、告警误报 | 4 小时 | 值班人 |

## 1. 常见故障处置

### 1.1 RPC 故障（Helius/QuickNode 429 或断连）
- **检测**：`scripts/check-rpc.sh`、`scripts/reconcile.sh` 报 RPC 错误；交易确认超时。
- **处置**：
  1. 确认 RPC Key 配额（Dashboard）；切备用 Key（`SOLANA_RPC_URL` 逗号分隔多 Key 已支持，重启服务生效）。
  2. 升级套餐或加 Key；不要重启疯狂重试（会叠加 429）。
  3. 观察 `WEBHOOK_RETRY_DELAY_MS` 与交易队列，必要时手动补发。

### 1.2 索引器（indexer）停止 / 滞后
- **检测**：`/api/indexer/status` 的 `lastPoolSnapshotAt` 超过 1 小时；`queue.failed > 0`；
  `scripts/reconcile.sh` 报 `PoolSnapshot 过期`。
- **处置**：
  1. 查看 indexer 日志（BullMQ 连接/订阅错误）。
  2. 重启 indexer 服务（幂等，会从订阅恢复；历史缺口由对账脚本发现）。
  3. 对账发现的状态差异：**以链上为准**，人工修正 DB 或等待索引器重放。

### 1.3 数据库故障
- **检测**：`/health` 返回 `db: down`。
- **处置**：
  1. 优先恢复服务（`kubectl rollout restart` / `docker compose restart`）。
  2. 如数据损坏：从备份恢复（`scripts/db-backup-restore.sh restore <dump>`），
     恢复后跑 `scripts/reconcile.sh` 核对链上一致性。
  3. **禁止**在未备份情况下手动改 DB 资金/状态字段。

### 1.4 订单状态不一致（confirm 与 indexer 竞态残留）
- **检测**：`scripts/reconcile.sh` 报 `订单 xxx 状态不一致`。
- **处置**：以链上为准。若 DB 落后，等 indexer 追平；若 DB 超前（少见），人工按链上修正。

### 1.5 安全事件（密钥泄露/管理员账号异常）
- **处置**：
  1. 立即吊销泄露密钥、撤销 refresh token（`invalidateUserState`）。
  2. 强制管理员改密 + 重置 TOTP。
  3. 冻结相关链上操作；如 upgrade authority 泄露且未冻结：立即转移/冻结。
  4. 保全证据（日志导出），按 [INCIDENT-RUNBOOK.md](INCIDENT-RUNBOOK.md) 走事件流程。

## 2. 值班检查单（每日）

```bash
# 1) 健康
for p in 3001 3003 3004 3005; do curl -sf http://localhost:$p/health; done
# 2) 对账（链上 vs DB）
SOLANA_RPC_URL=... DATABASE_URL=... TRADE_FINANCE_PROGRAM_ID=... \
  USDC_MINT=... bash scripts/reconcile.sh
# 3) 索引器
curl -sf http://localhost:3003/api/indexer/status
# 4) 备份（昨日备份存在且非空）
ls -la /backups/
# 5) 审计日志抽查
curl -sf http://localhost:3001/api/admin/audit-logs
```

## 3. 交接与复盘

- 每班交接：未解决告警、进行中的变更、RPC/备份状态。
- 每次 P0/P1 事件后 24h 内写复盘：时间线、根因、改进项、是否补测试。
