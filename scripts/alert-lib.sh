#!/usr/bin/env bash
# 告警公共库：冷却去重 + 分级发送。
# 用法: source alert-lib.sh; alert <key> <subject> <body>; alert_recover <key> <subject> <body>
#
# 邮件分级策略（生产运营原则）：
#   - 只有「影响系统生产运营」的严重告警 key 才真正发送邮件；
#   - 其余（业务/提示类，如上传突增、注册异常、还款提醒、池快照提示）仅写
#     /var/log/supply-chain-alert.log 本地日志，不发邮件。
#   - 白名单可用 /etc/supply-chain-alert.env 的 ALERT_EMAIL_KEYS 覆盖（逗号分隔）。
ALERT_BIN="/opt/supply-chain/scripts/alert-mail.py"
ALERT_STATE_DIR="/var/lib/supply-chain-alerts"
ALERT_COOLDOWN=1800   # 同一 key 两次告警最小间隔（秒）

mkdir -p "$ALERT_STATE_DIR"

# 邮件白名单默认值（2026-08-18 二次收紧）：**仅"会导致系统崩溃/站点不可用"才发邮件**——
#   app-health / app-health-ready（站点不可用）、vps-containers（容器持续异常）。
# 其余全部（内存/磁盘/备份/安全/索引器/证书预告等）仅写本地日志，不浪费邮件额度。
# 证书续期失败仍由 renew-cert.sh 单独发邮件（证书过期=站点不可用）。
DEFAULT_EMAIL_KEYS="app-health,app-health-ready,vps-containers"
ALERT_EMAIL_KEYS="${ALERT_EMAIL_KEYS:-$DEFAULT_EMAIL_KEYS}"
if [ -f /etc/supply-chain-alert.env ]; then
  _k=$(grep -E '^ALERT_EMAIL_KEYS=' /etc/supply-chain-alert.env 2>/dev/null | head -1 | cut -d= -f2-)
  [ -n "$_k" ] && ALERT_EMAIL_KEYS="$_k"
fi

is_email_key() { # key —— 在白名单内返回 0
  case ",${ALERT_EMAIL_KEYS}," in
    *",$1,"*) return 0 ;;
  esac
  return 1
}

alert() { # key subject body
  local key="$1" subject="$2" body="$3"
  local state="$ALERT_STATE_DIR/$key"
  local now
  now=$(date +%s)
  if [ -f "$state" ]; then
    local last
    last=$(cat "$state" 2>/dev/null || echo 0)
    if [ $((now - last)) -lt $ALERT_COOLDOWN ]; then
      return 0  # 冷却期内不重复告警
    fi
  fi
  if is_email_key "$key"; then
    # 生产运营级告警：真正发送邮件
    if python3 "$ALERT_BIN" "$subject" "$body"; then
      echo "$now" > "$state"
    fi
  else
    # 非生产影响告警：仅本地日志，不发邮件（仍记冷却，避免每轮刷日志）
    echo "$(date '+%F %T') [告警-仅日志] $key: $subject" >> /var/log/supply-chain-alert.log
    echo "$now" > "$state"
  fi
  # AI 运维自愈代理（后台非阻塞；未配置密钥时静默跳过）
  if [ -x /opt/supply-chain/scripts/ai-agent.py ] && [ -f /etc/supply-chain-ai.env ]; then
    printf '%s' "$body" | python3 /opt/supply-chain/scripts/ai-agent.py "$key" "$subject" \
      >> /var/log/supply-chain-ai-agent.log 2>&1 &
  fi
}

alert_recover() { # key subject body —— 恢复后发一次通知并清冷却
  local key="$1" subject="$2" body="$3"
  local state="$ALERT_STATE_DIR/$key"
  if [ -f "$state" ]; then
    if is_email_key "$key"; then
      python3 "$ALERT_BIN" "$subject" "$body"
    fi
    rm -f "$state"
  fi
}

alert_reset() { # key —— 仅清除冷却状态（不通知）
  rm -f "$ALERT_STATE_DIR/$1"
}
