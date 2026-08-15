#!/usr/bin/env bash
# ============================================================
# Cloudflare 告警通知策略管理（supplychain.de5.net → 邮件告警）
# 用法：
#   bash scripts/cf-alert-notifications.sh list     # 列出当前策略
#   bash scripts/cf-alert-notifications.sh ensure   # 幂等创建缺失的策略
#   bash scripts/cf-alert-notifications.sh verify   # 验证 token 与邮箱目的地
#   bash scripts/cf-alert-notifications.sh webhook  # 显示 webhook 目的地并发送测试
# 可选：设置 CF_WEBHOOK_ID 后，ensure 创建/更新策略时同时加入 webhook 投递（邮箱验证不可用时的替代通道）。
#   webhook 目的地 id 保存在 ~/.cf-secrets/cf-webhook-id
# 令牌来源（按优先级）：CLOUDFLARE_ALERT_TOKEN 环境变量
#   > ~/.cf-secrets/supply-chain-alert-token（推荐，自建令牌，Notifications 权限）
#   > CLOUDFLARE_API_TOKEN 环境变量（通用回退）
# 依赖：curl、python3。免费套餐可用告警已内置；付费类告警创建时会提示跳过。
# ============================================================
set -euo pipefail

ACCT="${CLOUDFLARE_ACCOUNT_ID:-5d1b3aece0dd984965ac5bfdf830b600}"
EMAIL="${CLOUDFLARE_ALERT_EMAIL:-14777904019@139.com}"
API="https://api.cloudflare.com/client/v4"

# 优先级：CLOUDFLARE_ALERT_TOKEN > ~/.cf-secrets/supply-chain-alert-token（推荐）> CLOUDFLARE_API_TOKEN
TOKEN="${CLOUDFLARE_ALERT_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$HOME/.cf-secrets/supply-chain-alert-token" ]]; then
  TOKEN="$(cat "$HOME/.cf-secrets/supply-chain-alert-token")"
fi
if [[ -z "$TOKEN" ]]; then
  TOKEN="${CLOUDFLARE_API_TOKEN:-}"
fi
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: 未找到 API 令牌。请设置 CLOUDFLARE_ALERT_TOKEN 或 ~/.cf-secrets/supply-chain-alert-token" >&2
  exit 1
fi

WEBHOOK_ID="${CF_WEBHOOK_ID:-}"
if [[ -z "$WEBHOOK_ID" && -f "$HOME/.cf-secrets/cf-webhook-id" ]]; then
  WEBHOOK_ID="$(cat "$HOME/.cf-secrets/cf-webhook-id")"
fi

BASE="$API/accounts/$ACCT/alerting/v3/policies"

cf() { curl -sS -X "$1" "$2" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" ${3:+-d "$3"}; }
ok()  { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }

# 每个条目：name|alert_type|description|filters(JSON 或空)
POLICIES=(
  "HTTP DDoS 攻击告警|dos_attack_l7|检测到 Layer 7 HTTP DDoS 攻击时邮件通知|"
  "SSL 证书事件告警|universal_ssl_event_type|SSL 证书验证/签发/续期/过期通知|"
  "自定义 SSL 证书事件告警|custom_ssl_certificate_event_type|自定义 SSL 证书事件通知|"
  "IP 封禁新增告警|block_notification_new_block|Cloudflare 新增 IP 封禁时通知|"
  "健康检查状态告警|health_check_status_notification|健康检查状态变化通知|{\"status\":[\"Unhealthy\"]}"
  "负载均衡健康告警|load_balancing_health_alert|负载均衡健康状态变化通知|"
  "Tunnel 健康告警|tunnel_health_event|Tunnel 健康事件通知|"
  "Cloudflare 事故通知|incident_alert|Cloudflare 平台事故创建/更新/解决通知|"
  "真实源站监控告警|real_origin_monitoring|真实源站 IP 变化通知|"
)

list_policies() {
  local res
  res="$(cf GET "$BASE")"
  python3 - "$res" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
if not d.get("success"):
    print("查询失败:", d.get("errors")); sys.exit(1)
policies=d.get("result",[])
if not policies:
    print("（无策略）")
for p in policies:
    print(f"{p['name']} | type={p['alert_type']} | enabled={p['enabled']} | id={p['id']}")
print(f"\n共 {len(policies)} 条策略；全部发往 {d.get('result',[{}])[0].get('mechanisms',{}).get('email',[{}])[0].get('id','?') if d.get('result') else '?'}")
PY
}

ensure_policies() {
  local res existing
  res="$(cf GET "$BASE")"
  existing="$(python3 - "$res" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
print("\n".join(p["name"] for p in d.get("result",[]) if d.get("success")))
PY
)"
  local name atype desc filters body
  for entry in "${POLICIES[@]}"; do
    IFS='|' read -r name atype desc filters <<< "$entry"
    if grep -qxF "$name" <<< "$existing"; then
      ok "${name}（已存在，跳过）"
      continue
    fi
    local mech="{\"email\":[{\"id\":\"$EMAIL\"}]}"
    if [[ -n "$WEBHOOK_ID" ]]; then
      mech="{\"email\":[{\"id\":\"$EMAIL\"}],\"webhooks\":[{\"id\":\"$WEBHOOK_ID\"}]}"
    fi
    if [[ -n "$filters" ]]; then
      body="{\"name\":\"$name\",\"alert_type\":\"$atype\",\"enabled\":true,\"description\":\"$desc\",\"mechanisms\":$mech,\"filters\":$filters}"
    else
      body="{\"name\":\"$name\",\"alert_type\":\"$atype\",\"enabled\":true,\"description\":\"$desc\",\"mechanisms\":$mech}"
    fi
    res="$(cf POST "$BASE" "$body")"
    if python3 -c "import json,sys; raise SystemExit(0 if json.loads('''$res''').get('success') else 1)" 2>/dev/null; then
      local id; id="$(python3 -c "import json;print(json.loads('''$res''')['result']['id'])")"
      ok "$name -> $id"
    else
      warn "$name 创建失败：$(echo "$res" | head -c 300)"
    fi
  done
}

verify_token() {
  local vres pres
  vres="$(cf GET "$API/user/tokens/verify")"
  echo "$vres" | python3 -c "import json,sys; d=json.load(sys.stdin); print('令牌有效:', d.get('result',{}).get('id'), '| status:', d.get('result',{}).get('status')) if d.get('success') else print('令牌 verify 端点返回:', d.get('errors'))"
  pres="$(cf GET "$BASE")"
  echo "$pres" | python3 -c "import json,sys; d=json.load(sys.stdin); print('告警策略读取:', 'OK('+str(len(d.get('result',[])))+' 条)' if d.get('success') else '失败 '+str(d.get('errors')))"
  echo "邮箱目的地查询需要控制台权限（API 令牌不可访问 destinations 端点）。"
  echo "请确认 139 邮箱收到过 Cloudflare 的验证邮件并已点击验证：控制台 → 通知 → 管理通知 → 邮箱。"
}

webhook_info() {
  if [[ -z "$WEBHOOK_ID" ]]; then
    echo "未找到 webhook 目的地 id（设置 CF_WEBHOOK_ID 或 ~/.cf-secrets/cf-webhook-id）"
    return 1
  fi
  echo "== webhook 目的地 $WEBHOOK_ID =="
  cf GET "$API/accounts/$ACCT/alerting/v3/destinations/webhooks" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for w in d.get('result',[]):
    if w.get('id')=='$WEBHOOK_ID':
        print('名称:', w.get('name')); print('URL:', w.get('url')); print('启用:', w.get('enabled'))
print('全部目的地:', [w.get('name') for w in d.get('result',[])])
"
}

case "${1:-list}" in
  list)   echo "== 当前 Cloudflare 告警策略 =="; list_policies ;;
  ensure) echo "== 幂等创建缺失策略（发往 ${EMAIL}${WEBHOOK_ID:+ + webhook}）=="; ensure_policies ;;
  verify) echo "== 令牌校验 =="; verify_token ;;
  webhook) webhook_info ;;
  *) echo "用法: $0 {list|ensure|verify|webhook}"; exit 1 ;;
esac
