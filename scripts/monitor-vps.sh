#!/usr/bin/env bash
# VPS 层面告警：内存 / 磁盘 / 容器健康 / 证书到期
source /opt/supply-chain/scripts/alert-lib.sh

HOSTNAME_N="$(hostname)"
DATE="$(date '+%F %T')"

# 1) 内存可用 < 300MB
avail_mb=$(free -m | awk '/^Mem:/{print $7}')
if [ "$avail_mb" -lt 300 ]; then
  alert vps-mem "[VPS 告警] ${HOSTNAME_N} 内存不足" "${DATE}
可用内存仅 ${avail_mb}MB，请检查容器或清理缓存。

$(free -h)"
else
  alert_recover vps-mem "[VPS 恢复] ${HOSTNAME_N} 内存已恢复" "${DATE}
当前可用内存 ${avail_mb}MB。"
fi

# 2) 磁盘使用 > 85%
disk_used=$(df / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$disk_used" -gt 85 ]; then
  alert vps-disk "[VPS 告警] ${HOSTNAME_N} 磁盘使用率 ${disk_used}%" "${DATE}
磁盘使用率已达 ${disk_used}%，请及时清理（docker system prune / 日志）。

$(df -h /)"
else
  alert_recover vps-disk "[VPS 恢复] ${HOSTNAME_N} 磁盘已恢复正常" "${DATE}
当前磁盘使用率 ${disk_used}%。"
fi

# 3) 容器健康：非 healthy / restarting 的 supply-chain 容器
#    自愈：首次发现异常先自动重启该容器并标记，下轮确认仍异常才告警，
#    避免瞬时/启动期状态导致「一直报容器异常」。
HEAL_MARKER="${ALERT_STATE_DIR}/selfheal"
unhealthy=""
for c in $(docker ps -a --format '{{.Names}}' | grep '^supply-chain-' | grep -vE 'backup'); do
  st=$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null)
  status="${st%%|*}"
  health="${st##*|}"
  if [ "$status" != "running" ] || { [ "$health" != "healthy" ] && [ "$health" != "none" ]; }; then
    if grep -qx "$c" "$HEAL_MARKER" 2>/dev/null; then
      # 上一轮已自动重启过，本轮仍异常 -> 真异常，告警并清除标记
      unhealthy="$unhealthy\n  - $c ($status / $health) [自愈失败]"
      sed -i "/^$c$/d" "$HEAL_MARKER" 2>/dev/null
    else
      # 首次发现：标记 + 自动重启，本轮不告警，等待下轮确认
      docker restart "$c" >/dev/null 2>&1 || true
      echo "$c" >> "$HEAL_MARKER"
      echo "${DATE} [自愈] 已自动重启容器 $c，等待下轮确认" >> /var/log/supply-chain-monitor.log
    fi
  else
    sed -i "/^$c$/d" "$HEAL_MARKER" 2>/dev/null
  fi
done
if [ -n "$unhealthy" ]; then
  alert vps-containers "[系统告警] ${HOSTNAME_N} 容器异常" "${DATE}
以下容器非健康状态：${unhealthy}

$(docker ps --format 'table {{.Names}}\t{{.Status}}' | head -20)"
else
  alert_recover vps-containers "[系统恢复] ${HOSTNAME_N} 容器全部正常" "${DATE}
所有 supply-chain 容器均健康。"
fi

# 4) fail2ban 新封禁（仅记录本地日志，不发送邮件告警）
F2B_LOG=/var/log/fail2ban.log
F2B_STATE="$ALERT_STATE_DIR/f2b-last-line"
if [ -f "$F2B_LOG" ]; then
  total=$(wc -l < "$F2B_LOG")
  last=$(cat "$F2B_STATE" 2>/dev/null || echo 0)
  new_bans=$(tail -n +$((last + 1)) "$F2B_LOG" 2>/dev/null | grep -c "Ban ")
  if [ "${new_bans:-0}" -gt 0 ]; then
    ips=$(tail -n +$((last + 1)) "$F2B_LOG" | grep "Ban " | grep -oE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" | sort -u | tr "\n" " ")
    echo "${DATE} [fail2ban] 新增封禁 ${new_bans} 个 IP：${ips}（仅记录，不发送邮件告警）"
  fi
  echo "$total" > "$F2B_STATE"
fi

# 5) TLS 证书到期 < 30 天（每天最多 1 次）
for dom in supplychain.de5.net; do
  cert="/etc/letsencrypt/live/${dom}/cert.pem"
  if [ -f "$cert" ]; then
    expire=$(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2)
    exp_epoch=$(date -d "$expire" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$expire" +%s 2>/dev/null)
    now=$(date +%s)
    if [ -n "$exp_epoch" ]; then
      days=$(( (exp_epoch - now) / 86400 ))
      if [ "$days" -lt 30 ]; then
        alert cert-expire "[证书告警] ${dom} 证书 ${days} 天后到期" "${DATE}
证书将于 ${expire} 到期（剩 ${days} 天），请检查 certbot 续期。"
      else
        alert_reset cert-expire
      fi
    fi
  fi
done
exit 0
