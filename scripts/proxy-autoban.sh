#!/bin/bash
# 代理来源观测 + 可选自动封禁
# 2026-09-15 重写：默认「仅告警不封禁」，并支持 CIDR 白名单。
#
# 背景（事故复盘）：旧版每 5 分钟把「白名单外的代理来源 IP」直接 `ufw insert 1 deny`，
# 而家庭/手机宽带 IP 是动态的（广东移动 120.229/120.235/111.55/223.104/27.38/163.125…），
# 一旦换 IP 且当下没有活跃连接，就会被自己的脚本封禁 → SSH 失联（累计误封 32 次）。
#
# 新策略：
#   1. 默认 AUTOBAN_ENABLED=0：只写日志，不做任何封禁（彻底防自锁）
#   2. CIDR 白名单：/etc/supply-chain-proxy-allowlist（支持 a.b.c.d/nn）
#   3. 私有/回环地址、当前活跃 SSH/代理连接一律不封
#   4. 需要恢复自动封禁时：AUTOBAN_ENABLED=1（建议先观察日志一周）
set -uo pipefail

LOG="/var/lib/docker/volumes/a122927aeedf5a96eb409cee6d3efd85182924f7083721022dd0d30376343451/_data/access.log"
STATE="/var/lib/proxy-observe/autoban_pos"
ACTION="/var/lib/proxy-observe/autoban-actions.log"
ALLOWLIST="/etc/supply-chain-proxy-allowlist"
AUTOBAN_ENABLED="${AUTOBAN_ENABLED:-0}"

mkdir -p "$(dirname "$STATE")"
[ -f "$LOG" ] || exit 0

ACTIVE=$(ss -tn state established 2>/dev/null | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | sort -u | tr '\n' ' ')

LAST=$(cat "$STATE" 2>/dev/null || echo 0)
SIZE=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
[ "$SIZE" -le "$LAST" ] && { echo "$SIZE" > "$STATE"; exit 0; }

NEW=$(tail -c +$((LAST+1)) "$LOG" | grep "accepted" | grep -oE "from [0-9.]+" | awk '{print $2}' | sort -u || true)
echo "$SIZE" > "$STATE"
[ -z "$NEW" ] && exit 0

is_allowed() {
  python3 - "$1" "$ALLOWLIST" "$ACTIVE" <<'PY'
import ipaddress, sys
ip, allow_file, active_raw = sys.argv[1], sys.argv[2], sys.argv[3]
active = set(active_raw.split())
try:
    addr = ipaddress.ip_address(ip)
except ValueError:
    sys.exit(1)
if addr.is_private or addr.is_loopback:
    sys.exit(0)
if ip in active:
    sys.exit(0)
try:
    with open(allow_file, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#")[0].strip()
            if not line:
                continue
            try:
                if "/" in line:
                    if addr in ipaddress.ip_network(line, strict=False):
                        sys.exit(0)
                elif ip == line:
                    sys.exit(0)
            except ValueError:
                continue
except FileNotFoundError:
    pass
sys.exit(1)
PY
}

for ip in $NEW; do
  is_allowed "$ip" && continue
  mode="仅告警"
  [ "$AUTOBAN_ENABLED" = "1" ] && mode="封禁"
  echo "[$(date +%F_%T)] ⚠️ 未知代理来源: $ip（模式=$mode）" >> "$ACTION"
  if [ "$AUTOBAN_ENABLED" = "1" ]; then
    if ufw insert 1 deny from "$ip" >/dev/null 2>&1; then
      echo "[$(date +%F_%T)] 🚨 已封禁: $ip" >> "$ACTION"
    fi
  fi
done
