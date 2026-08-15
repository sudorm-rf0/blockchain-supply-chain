#!/usr/bin/env bash
# 供应链系统层面告警：健康检查 / indexer 队列 / 备份
source /opt/supply-chain/scripts/alert-lib.sh

BASE="https://supplychain.de5.net"
DATE="$(date '+%F %T')"

# 1) /health 与 /health/ready（连续 2 次失败才告警）
for path in /health /health/ready; do
  ok=0
  for i in 1 2; do
    code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$BASE$path" 2>/dev/null)
    if [ "$code" = "200" ]; then ok=1; break; fi
    sleep 2
  done
  key="app-${path#/}"
  key="${key//\//-}"
  if [ "$ok" = "1" ]; then
    alert_recover "$key" "[系统恢复] ${path} 已恢复" "${DATE}
${BASE}${path} 返回 200。"
  else
    alert "$key" "[系统告警] ${path} 不可用" "${DATE}
${BASE}${path} 探测失败（HTTP ${code:-无响应}），请检查后端服务。"
  fi
done

# 2) indexer 队列 failed 增长 + 池快照过旧
st=$(curl -s -m 8 "$BASE/api/indexer/status" 2>/dev/null)
if [ -n "$st" ]; then
  failed=$(echo "$st" | python3 -c "import json,sys; print(json.load(sys.stdin)['queue']['failed'])" 2>/dev/null || echo 0)
  last_snap=$(echo "$st" | python3 -c "import json,sys; print(json.load(sys.stdin).get('lastPoolSnapshotAt') or '')" 2>/dev/null || echo "")
  last_file="/var/lib/supply-chain-alerts/indexer-failed"
  prev=$(cat "$last_file" 2>/dev/null || echo 0)
  if [ "$failed" -gt "$prev" ] && [ "$prev" -gt 0 ]; then
    alert indexer-failed "[系统告警] indexer 队列失败任务增长" "${DATE}
failed: ${prev} -> ${failed}，请查看 indexer 日志。"
  fi
  echo "$failed" > "$last_file"
  if [ -z "$last_snap" ]; then
    # 池快照缺失（devnet 旧账户布局导致的已知状态），每天提示一次
    alert indexer-snap "[提示] indexer 资金池快照缺失" "${DATE}
lastPoolSnapshotAt 为空（devnet 上旧版 PoolState 账户布局所致），
需通过应用重新初始化资金池后才会同步。"
  else
    alert_reset indexer-snap
  fi
else
  alert indexer-api "[系统告警] indexer 状态接口不可达" "${DATE}
${BASE}/api/indexer/status 无响应。"
fi

# 3) 每日备份产物检查（backup 容器每天 02:00 写入 /backups）
backups="/backups"
if [ -d "$backups" ]; then
  newest=$(ls -t "$backups"/supply_chain-*.dump 2>/dev/null | head -1)
  if [ -z "$newest" ]; then
    alert backup-missing "[数据告警] 未发现数据库备份文件" "${DATE}
${backups} 下没有备份 dump，请检查 backup 容器。"
  else
    age_h=$(( ($(date +%s) - $(stat -c %Y "$newest" 2>/dev/null || echo 0)) / 3600 ))
    if [ "$age_h" -gt 48 ]; then
      alert backup-stale "[数据告警] 备份已超过 48 小时" "${DATE}
最新备份: ${newest}（${age_h} 小时前），请检查 backup 容器。"
    else
      alert_recover backup-stale "[数据恢复] 备份正常" "${DATE}
最新备份: ${newest}（${age_h} 小时前）。"
    fi
  fi
fi
exit 0
