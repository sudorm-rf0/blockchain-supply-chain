#!/usr/bin/env bash
# 告警公共库：冷却去重 + 发送。
# 用法: source alert-lib.sh; alert <key> <subject> <body>; alert_recover <key> <subject> <body>
ALERT_BIN="/opt/supply-chain/scripts/alert-mail.py"
ALERT_STATE_DIR="/var/lib/supply-chain-alerts"
ALERT_COOLDOWN=1800   # 同一 key 两次告警最小间隔（秒）

mkdir -p "$ALERT_STATE_DIR"

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
  if python3 "$ALERT_BIN" "$subject" "$body"; then
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
    python3 "$ALERT_BIN" "$subject" "$body"
    rm -f "$state"
  fi
}

alert_reset() { # key —— 仅清除冷却状态（不通知）
  rm -f "$ALERT_STATE_DIR/$1"
}
