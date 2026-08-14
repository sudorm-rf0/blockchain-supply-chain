#!/usr/bin/env bash
# ============================================================
# 一键配置 Cloudflare 安全防护与优化（supply-chain.de5.net）
# 用法：
#   CLOUDFLARE_API_TOKEN=<token> \
#   CLOUDFLARE_ZONE_ID=<zone-id> \
#   bash scripts/configure-cloudflare-security.sh
# 依赖：curl、python3。需要 token 权限：Zone:Settings:Edit / WAF / Rate Limit / Cache。
# 幂等：每步先 GET 检查，已生效则跳过；权限不足打印 WARN 并给出手动路径。
# ============================================================
set -euo pipefail

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
ZONE="${CLOUDFLARE_ZONE_ID:-}"
API="https://api.cloudflare.com/client/v4"

if [[ -z "$TOKEN" || -z "$ZONE" ]]; then
  echo "ERROR: 需要 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ZONE_ID" >&2
  echo "Zone ID 可在 Cloudflare 控制台 → 域名 supplychain.de5.net → 概览右侧找到" >&2
  exit 1
fi

cf() { # cf METHOD PATH [JSON]
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $TOKEN"
  fi
}

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("success")); print(json.dumps(d.get("errors", []), ensure_ascii=False))' ; }

ok() { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }

echo "== 目标 Zone: $ZONE =="
echo "== 1/8 Zone 基础安全设置 =="
for spec in "security_level:high" "browser_check:on" "ssl:full" "tls_1_3:on" "automatic_https_rewrites:on" "brotli:on" "min_tls_version:1.2"; do
  name="${spec%%:*}"; value="${spec##*:}"
  cur="$(cf GET "/zones/$ZONE/settings/$name" | python3 -c "import json,sys; print(json.load(sys.stdin).get('result',{}).get('value',''))" 2>/dev/null || true)"
  if [[ "$cur" == "$value" ]]; then
    ok "$name = $value（已生效）"
  else
    res="$(cf PUT "/zones/$ZONE/settings/$name" "{\"value\":\"$value\"}")"
    if echo "$res" | python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('success') else 1)" 2>/dev/null; then
      ok "$name = $value"
    else
      warn "$name 设置失败（权限不足？）→ 手动：Cloudflare 控制台 → SSL/TLS、安全性 页面开启"
    fi
  fi
done

echo "== 2/8 HSTS（浏览器强制 HTTPS）=="
HSTS='{"value":{"strict_transport_security":{"enabled":true,"max_age":31536000,"include_subdomains":true,"preload":false}}}'
if cf PUT "/zones/$ZONE/settings/security_header" "$HSTS" | python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('success') else 1)" 2>/dev/null; then
  ok "HSTS 已开启（max-age 1 年）"
else
  warn "HSTS 设置失败 → 手动：SSL/TLS → 边缘证书 → HSTS 开启"
fi

echo "== 3/8 Bot Fight Mode（拦截已知机器人）=="
if cf PUT "/zones/$ZONE/settings/bot_fight_mode" '{"value":"on"}' | python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('success') else 1)" 2>/dev/null; then
  ok "Bot Fight Mode 已开启"
else
  warn "Bot Fight Mode 失败 → 手动：安全性 → Bots → Bot Fight Mode 开启"
fi

echo "== 4/8 WAF 自定义规则 =="
warn "跳过：托管质询不适用于 API（fetch 无法自动通过质询，会导致登录等接口 403）。"
warn "API 防护请依赖：Turnstile 人机验证 + 速率限制 + 后端限速（已启用）。"

echo "== 5/8 速率限制（登录/注册防爆破）=="
RATELIMIT='{"rules":[{"action":"block","ratelimit":{"characteristics":["cf.colo.id","ip.src"],"period":10,"requests_per_period":4,"mitigation_timeout":10},"expression":"(http.request.uri.path contains \"/api/auth/login\" or http.request.uri.path contains \"/api/auth/register\" or http.request.uri.path contains \"/api/email-verification/send\" or http.request.uri.path contains \"/api/auth/email-otp/send\" or http.request.uri.path contains \"/api/auth/change-password\" or http.request.uri.path contains \"/api/auth/change-email\" or http.request.uri.path contains \"/api/auth/delete-account\" or http.request.uri.path contains \"/api/financing/apply\")","description":"sensitive endpoints 4/10s (login/register/otp/password/email/delete/financing)"}]}'
if cf PUT "/zones/$ZONE/rulesets/phases/http_ratelimit/entrypoint" "$RATELIMIT" | python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('success') else 1)" 2>/dev/null; then
  ok "速率限制已生效（/api/auth/* 每 10 秒超 4 次封禁；免费版参数限制 period/timeout=10）"
else
  warn "速率限制设置失败 → 手动：安全性 → 速率限制（免费版：period 10s、超限封禁 10s）"
fi


echo "== 4b/8 WAF 自定义规则（探测路径/路径穿越/注入探测拦截）=="
WAF='{"rules":[{"action":"block","expression":"(http.request.uri.path contains \"/.git\" or http.request.uri.path contains \"/.env\" or http.request.uri.path contains \"/.svn\" or http.request.uri.path contains \"/backup\" or http.request.uri.path contains \"/server-status\" or http.request.uri.path contains \"/actuator\" or http.request.uri.path contains \"/wp-admin\" or http.request.uri.path contains \"/wp-login\")","description":"block probing paths"},{"action":"block","expression":"(http.request.uri.path contains \"..\" or http.request.uri.path contains \"%2e%2e\" or http.request.uri.path contains \"/etc/passwd\" or http.request.uri.path contains \"/etc/shadow\")","description":"block path traversal"},{"action":"block","expression":"(http.request.uri.query contains \"select \" or http.request.uri.query contains \"union select\" or http.request.uri.query contains \"<script>\" or http.request.uri.query contains \"alert(\")","description":"block common sqli/xss probes"},{"action":"block","expression":"(not starts_with(http.request.uri.path, \"/_next/static/\") and (http.request.uri.path contains \".css\" or http.request.uri.path contains \".js\" or http.request.uri.path contains \".png\" or http.request.uri.path contains \".jpg\" or http.request.uri.path contains \".jpeg\" or http.request.uri.path contains \".gif\" or http.request.uri.path contains \".svg\" or http.request.uri.path contains \".pdf\" or http.request.uri.path contains \".doc\" or http.request.uri.path contains \".docx\" or http.request.uri.path contains \".ico\"))","description":"block cache deception probes (static ext outside /_next/static/)"}]}'
if cf PUT "/zones/$ZONE/rulesets/phases/http_request_firewall_custom/entrypoint" "$WAF" | python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('success') else 1)" 2>/dev/null; then
  ok "WAF 自定义规则已生效（探测路径/穿越/注入/缓存欺骗）"
else
  warn "WAF 自定义规则设置失败 → 手动：安全性 → WAF → 自定义规则"
fi

echo "== 6/8 缓存优化（前端静态资源 /_next/static/ 走边缘缓存）=="
CACHE_RULE='{
  "action":"cache_rule",
  "expression":"(http.host eq \"supplychain.de5.net\" or http.host eq \"www.supplychain.de5.net\") and starts_with(http.request.uri.path, \"/_next/static/\")",
  "description":"cache next static assets",
  "action_parameters":{"cache":true,"edge_ttl":{"mode":"override_origin","default":2592000}}
}'
if cf POST "/zones/$ZONE/rulesets" "{\"name\":\"supply-chain-cache\",\"kind\":\"zone\",\"phase\":\"http_request_cache_settings\",\"rules\":[$CACHE_RULE]}" | python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('success') else 1)" 2>/dev/null; then
  ok "缓存规则已创建（/_next/static/* 边缘缓存 30 天）"
else
  warn "缓存规则创建失败 → 手动：缓存 → Cache Rules 创建（表达式 starts_with(uri.path, \"/_next/static/\") → Cache Everything，Edge TTL 1 个月）"
fi

echo "== 7/8 Under Attack / 安全级别 =="
# security_level 已在上方设置；攻击时可在控制台一键开启 Under Attack Mode

echo "== 8/8 汇总 =="
echo "----------------------------------------"
echo "已在代码层生效（无需 CF 配置）："
echo "  - nginx：HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy"
echo "  - nginx：/_next/static/* 缓存头（immutable 30 天）"
echo "  - 登录/注册：Cloudflare Turnstile 人机验证"
echo "  - 后端：接口限速（throttle）+ TOTP + 密码强度"
echo "----------------------------------------"
echo "如上方有 ⚠️ 项，请到 Cloudflare 控制台手动开启（或提供带 Zone:Settings/WAF/RateLimit/Cache:Edit 权限的 token 重跑本脚本）"
echo "手动路径见 docs/CLOUDFLARE-SECURITY.md"
