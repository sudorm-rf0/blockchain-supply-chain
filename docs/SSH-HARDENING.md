# VPS SSH 加固与自愈（2026-08-21）

## 故障记录（2026-08-21）
- **现象**：SSH 连接被拒，`kex_exchange_identification: Connection closed by remote host`；TCP 22 可连但 sshd 不发 banner；Web 服务（Cloudflare 隧道）正常。
- **根因**：sshd `MaxStartups` 未配置（默认 `10:30:100`），公网扫描/并发未认证连接占满 10 个槽位后，合法连接在协议协商阶段被直接关闭。fail2ban 有防护但按 IP ban，广撒网扫描器仍可瞬时占满。
- **解决**：VPS 控制台复位重启恢复访问。

## 加固措施（防复发）
1. **sshd 参数**（`/etc/ssh/sshd_config.d/99-ssh-stability.conf`）：
   - `MaxStartups 30:60:200`（并发容纳从 10 → 30，扫描更难占满）
   - `LoginGraceTime 20`（20 秒未认证即断开，快速释放占位连接）
   - `MaxSessions 20`
2. **fail2ban**（已启用，开机自启）：sshd jail，maxretry=5，bantime=24h，持续 ban 扫描器。
3. **SSH 健康自愈监控**（`/usr/local/bin/ssh-health-check.sh`，cron 每 5 分钟）：
   - 读取本地 22 端口 banner（须为 `SSH-2.0-*`）
   - 异常 → 自动 `systemctl restart ssh` → 仍异常则邮件告警到 139
   - 仓库副本：`scripts/ssh-health-check.sh`
4. **告警通道**：`/etc/supply-chain-alert.env`（Resend 有效 key + `ALERT_RECIPIENT=14777904019@139.com`），实测发信成功。
5. 确认项：`PermitRootLogin prohibit-password`、`PasswordAuthentication no`、`PubkeyAuthentication yes`、ufw 仅开放必要端口。

## 验证
- `sshd -T` 确认 `maxstartups 30:60:200 / logingracetime 20`
- `bash /usr/local/bin/ssh-health-check.sh` 正常 exit 0
- 告警测试邮件已送达 139 邮箱
