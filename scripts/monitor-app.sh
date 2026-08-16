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
    # 池快照缺失（devnet 旧账户布局导致的已知状态），每天最多提示一次
    SNAP_STATE="$ALERT_STATE_DIR/indexer-snap-daily"
    now_s=$(date +%s)
    last_send=$(cat "$SNAP_STATE" 2>/dev/null || echo 0)
    if [ $((now_s - last_send)) -gt 86400 ]; then
      python3 "$ALERT_BIN" "[提示] indexer 资金池快照缺失" "${DATE}
lastPoolSnapshotAt 为空（devnet 上旧版 PoolState 账户布局所致），
需通过应用重新初始化资金池后才会同步。"
      echo "$now_s" > "$SNAP_STATE"
    fi
  else
    alert_reset indexer-snap-daily
  fi
else
  alert indexer-api "[系统告警] indexer 状态接口不可达" "${DATE}
${BASE}/api/indexer/status 无响应。"
fi

# 3.5) 今日上传数突增（阈值可调）
UPLOAD_ALERT_THRESHOLD=${UPLOAD_ALERT_THRESHOLD:-200}
today_uploads=$(docker exec supply-chain-postgres psql -U supply -d supply_chain -t -A \
  -c "SELECT count(*) FROM files WHERE \"createdAt\" >= date_trunc('day', now());" 2>/dev/null | tr -d ' ')
if [ "${today_uploads:-0}" -gt "$UPLOAD_ALERT_THRESHOLD" ]; then
  alert app-uploads "[业务告警] 今日上传量突增 ${today_uploads} 份" "${DATE}
今日文件上传数已达 ${today_uploads} 份（阈值 ${UPLOAD_ALERT_THRESHOLD}），请确认是否异常。"
else
  alert_reset app-uploads
fi

# 3.6) 今日注册数异常
REGISTER_ALERT_THRESHOLD=${REGISTER_ALERT_THRESHOLD:-50}
today_reg=$(docker exec supply-chain-postgres psql -U supply -d supply_chain -t -A \
  -c "SELECT count(*) FROM \"User\" WHERE \"createdAt\" >= date_trunc('day', now());" 2>/dev/null | tr -d ' ')
if [ "${today_reg:-0}" -gt "$REGISTER_ALERT_THRESHOLD" ]; then
  alert app-register "[业务告警] 今日注册数异常 ${today_reg} 个" "${DATE}
今日新增用户 ${today_reg} 个（阈值 ${REGISTER_ALERT_THRESHOLD}），可能存在批量注册。"
else
  alert_reset app-register
fi

# 3.7) 登录爆破检测（Redis login:fail:* 计数）
RD_PW=$(grep -E "^REDIS_PASSWORD=" /opt/supply-chain/deploy/vps/.env.data | cut -d= -f2)
max_fail=0
while IFS= read -r k; do
  v=$(docker exec supply-chain-redis redis-cli -a "$RD_PW" --no-auth-warning GET "$k" 2>/dev/null)
  [ "${v:-0}" -gt "$max_fail" ] && max_fail=$v
done < <(docker exec supply-chain-redis redis-cli -a "$RD_PW" --no-auth-warning --scan --pattern "login:fail:*" 2>/dev/null)
if [ "$max_fail" -ge 5 ]; then
  alert app-login-brute "[安全告警] 检测到登录爆破尝试" "${DATE}
Redis 中登录失败计数最高达 ${max_fail} 次，可能存在暴力破解，请检查 fail2ban 与登录日志。"
else
  alert_reset app-login-brute
fi

# 3.8) 订单还款到期提醒（REPAYING 且 账期到期在 48h 内）
REPAY_WINDOW_HOURS=${REPAY_WINDOW_HOURS:-48}
due_deals=$(docker exec supply-chain-postgres psql -U supply -d supply_chain -t -A \
  -c "SELECT string_agg(dealId || ' (' || to_char(\"createdAt\" + make_interval(secs => tenor*86400), 'MM-DD HH24:MI') || ')', ', ') FROM \"TradeDeal\" WHERE status='REPAYING' AND \"createdAt\" + make_interval(secs => tenor*86400) < now() + make_interval(hours => ${REPAY_WINDOW_HOURS}) AND \"createdAt\" + make_interval(secs => tenor*86400) > now();" 2>/dev/null | tr -d ' ')
if [ -n "$due_deals" ] && [ "$due_deals" != "" ]; then
  alert app-repay-due "[业务提醒] 订单即将到期还款" "${DATE}
以下 ${REPAY_WINDOW_HOURS} 小时内到期的 REPAYING 订单：${due_deals}"
else
  alert_reset app-repay-due
fi

# 3.9) ClamAV 容器健康（病毒扫描依赖；unhealthy/停止时告警）
clam_st=$(docker inspect --format '{{.State.Health.Status}}' supply-chain-clamav 2>/dev/null || echo "missing")
if [ "$clam_st" = "healthy" ]; then
  alert_reset app-clamav
else
  alert app-clamav "[系统告警] ClamAV 异常" "${DATE}
supply-chain-clamav 状态：${clam_st}，请检查容器日志（病毒扫描将降级跳过）。"
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
