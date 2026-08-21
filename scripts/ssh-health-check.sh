#!/usr/bin/env bash
# SSH 健康自愈监控：读取本地 22 端口 banner，异常自动重启 sshd 并邮件告警
# 由 cron 每 5 分钟执行。2026-08-21 添加（SSH 故障根因：MaxStartups 被占满）
LOG=/var/log/ssh-health-check.log
ts() { date "+%F %T"; }

check_banner() {
  timeout 6 bash -c 'exec 3<>/dev/tcp/127.0.0.1/22; IFS= read -r -t 4 line <&3; echo "$line"' 2>/dev/null
}

BANNER=$(check_banner)
if [[ "$BANNER" == SSH-2.0-* ]]; then
  exit 0
fi

echo "$(ts) sshd 异常（banner=[${BANNER}]），尝试重启 ssh" >> "$LOG"
systemctl restart ssh 2>/dev/null
sleep 3
BANNER2=$(check_banner)
if [[ "$BANNER2" == SSH-2.0-* ]]; then
  echo "$(ts) 重启后恢复" >> "$LOG"
  python3 /opt/supply-chain/scripts/alert-mail.py "SSH 故障已自动恢复" "检测到 sshd 无响应，已自动重启并恢复（$(ts)）。" 2>>"$LOG" || true
else
  echo "$(ts) 重启后仍未恢复！" >> "$LOG"
  python3 /opt/supply-chain/scripts/alert-mail.py "SSH 故障未自动恢复" "sshd 重启后仍无 banner（$(ts)），需要人工介入。" 2>>"$LOG" || true
fi
