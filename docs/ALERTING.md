# 邮件告警（VPS + 供应链系统）

## 告警项

| 类别 | 触发条件 | 冷却 |
|---|---|---|
| VPS 内存 | 可用 < 300MB | 30 分钟 |
| VPS 磁盘 | 使用率 > 85% | 30 分钟 |
| 容器健康 | supply-chain 容器非 healthy/重启 | 30 分钟 |
| 证书 | TLS 证书 < 30 天到期 | 1 天 |
| 应用健康 | `/health` / `/health/ready` 连续 2 次失败 | 30 分钟 |
| indexer | 队列 failed 增长；池快照缺失 | 30 分钟 / 1 天 |
| 备份 | 无备份文件或最新备份 > 48h | 30 分钟 |
| 上传突增 | 今日上传 > 200（`UPLOAD_ALERT_THRESHOLD`） | 30 分钟 |
| 注册异常 | 今日注册 > 50（`REGISTER_ALERT_THRESHOLD`） | 30 分钟 |
| 登录爆破 | Redis `login:fail:*` 计数 ≥ 5 | 30 分钟 |
| 还款到期 | REPAYING 且账期到期在 48h 内（`REPAY_WINDOW_HOURS`） | 30 分钟 |
| fail2ban | 新增封禁 IP | 30 分钟 |

恢复时自动发送"已恢复"通知（除证书/池快照提示外）。

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
