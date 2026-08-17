# 邮件告警（VPS + 供应链系统）

## 邮件分级策略（重要）

**原则：只有影响系统生产运营的严重问题才发邮件；业务/提示类问题只写本地日志，不发邮件。**

- **发邮件（系统/生产运营级）**：服务不可用、容器异常、内存/磁盘告急、备份失效、
  indexer 同步异常、登录爆破、证书临近到期、需人工介入。
- **仅本地日志（业务/提示级）**：上传突增、注册异常、还款到期提醒、indexer 池快照缺失提示、
  fail2ban 封禁记录、AI 已自动处理完成。
- 白名单：`scripts/alert-lib.sh` 内 `ALERT_EMAIL_KEYS`（默认值），可在
  `/etc/supply-chain-alert.env` 中覆盖（逗号分隔）：
  ```
  ALERT_EMAIL_KEYS=vps-mem,vps-disk,vps-containers,app-health,app-health-ready,indexer-api,indexer-failed,backup-missing,backup-stale,app-clamav,app-login-brute,cert-expire
  ```
- AI 自愈：`AI_EMAIL_AUTO_FIX=1` 时"已自动处理"也发邮件（默认 0=仅日志）；
  "需人工介入"始终发邮件。

## 告警项

| 类别 | 触发条件 | 冷却 | 邮件 |
|---|---|---|---|
| VPS 内存 | 可用 < 300MB | 30 分钟 | ✅ |
| VPS 磁盘 | 使用率 > 85% | 30 分钟 | ✅ |
| 容器健康 | supply-chain 容器非 healthy/重启 | 30 分钟 | ✅ |
| 证书 | TLS 证书 < 30 天到期 | 1 天 | ✅ |
| 应用健康 | `/health` / `/health/ready` 连续 2 次失败 | 30 分钟 | ✅ |
| indexer 队列 | 队列 failed 增长 | 30 分钟 | ✅ |
| indexer 接口 | 状态接口不可达 | 30 分钟 | ✅ |
| 备份 | 无备份文件或最新备份 > 48h | 30 分钟 | ✅ |
| ClamAV | 容器非 healthy（病毒扫描降级） | 30 分钟 | ✅ |
| 登录爆破 | Redis `login:fail:*` 计数 ≥ 5 | 30 分钟 | ✅ |
| 上传突增 | 今日上传 > 200（`UPLOAD_ALERT_THRESHOLD`） | 30 分钟 | ❌ 仅日志 |
| 注册异常 | 今日注册 > 50（`REGISTER_ALERT_THRESHOLD`） | 30 分钟 | ❌ 仅日志 |
| 还款到期 | REPAYING 且账期到期在 48h 内（`REPAY_WINDOW_HOURS`） | 30 分钟 | ❌ 仅日志 |
| 池快照缺失 | indexer `lastPoolSnapshotAt` 为空（devnet 旧布局已知状态） | 1 天 | ❌ 仅日志 |
| fail2ban | 新增封禁 IP | — | ❌ 仅日志 |

恢复时自动发送"已恢复"通知（同样仅限发邮件白名单内的 key）。

## 配置（只需一次）

1. 准备发件邮箱 SMTP（如 139/QQ/163）并获取授权码
2. VPS 上编辑 `/etc/supply-chain-alert.env`（参照 `deploy/vps/alert.env.example`）：
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`
   - `ALERT_RECIPIENT`（当前默认 `14777904019@139.com`）
3. 测试：`python3 /opt/supply-chain/scripts/alert-mail.py "测试" "这是一封测试告警邮件"`

未配置 SMTP 时，告警仅写 `/var/log/supply-chain-alert.log`（dry-run），不影响系统运行。

## 运行方式

- cron 每 5 分钟：`monitor-vps.sh`（VPS 资源/容器/证书）+ `monitor-app.sh`（应用健康/队列/备份）
- 已有：`supply-chain-watchdog.sh` 每 2 分钟重启不健康服务；`supply-chain-renew-cert.sh` 每天续期证书
- 日志：`/var/log/supply-chain-alert.log`、`/var/log/supply-chain-watchdog.log`
