#!/usr/bin/env bash
# 一键健康检查:Codex-DeepSeek 翻译代理
# 用法: bash check-codex-deepseek.sh
# 检查: 启动任务 / 端口 / 鉴权key / 上游连通 / 代理基本响应
set -u
PORT=15723
LABEL=com.ccswitch-deepseek.proxy
LOG=~/Library/Logs/codex-deepseek-proxy.log
ERRLOG=~/Library/Logs/codex-deepseek-proxy.error.log
pass(){ printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail(){ printf "  \033[31m✗\033[0m %s\n" "$1"; }
info(){ printf "  \033[36m…\033[0m %s\n" "$1"; }

echo "=========================================="
echo "  Codex ↔ DeepSeek 代理健康检查"
echo "=========================================="

# 1. launchd 任务
echo "[1] launchd 任务 ($LABEL)"
if launchctl list 2>/dev/null | grep -q "$LABEL"; then
  pid=$(launchctl list 2>/dev/null | awk -v l="$LABEL" '$0~l{print $1}')
  code=$(launchctl list 2>/dev/null | awk -v l="$LABEL" '$0~l{print $2}')
  pass "已登记  pid=$pid  上次退出码=$code"
else
  fail "未在 launchd 登记 → 尝试加载"
  launchctl load ~/Library/LaunchAgents/com.ccswitch-deepseek.proxy.plist 2>/dev/null && info "已尝试加载"
fi

# 2. 端口监听
echo "[2] 端口监听 127.0.0.1:$PORT"
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  pass "正在监听:$(lsof -nP -iTCP:$PORT -sTCP:LISTEN | tail -1 | awk '{print $1" pid="$2}')"
else
  fail "未监听! 重启: launchctl kickstart -k gui/\$(id -u)/$LABEL"
fi

# 3. 鉴权 key
echo "[3] DeepSeek API key"
if [ -f ~/.codex/auth.json ] && grep -q "sk-" ~/.codex/auth.json; then
  pass "key 已配置"
else
  fail "未找到有效 key (~/.codex/auth.json)"
fi

# 4. 代理 models 响应
echo "[4] 代理 /v1/models"
if curl -sS -m 5 http://127.0.0.1:$PORT/v1/models | grep -q "deepseek"; then
  pass "返回正常"
else
  fail "models 无响应"
fi

# 5. 上游连通(直接打 DeepSeek)
echo "[5] 上游 api.deepseek.com 连通"
KEY=$(grep -oE '"OPENAI_API_KEY"[ ]*:[ ]*"[^"]*"' ~/.codex/auth.json | sed -E 's/.*"([^"]*)"$/\1/')
if [ -n "$KEY" ]; then
  code=$(curl -sS -o /dev/null -w "%{http_code}" -m 15 https://api.deepseek.com/v1/models \
    -H "Authorization: Bearer $KEY" 2>/dev/null)
  if [ "$code" = "200" ]; then pass "上游 OK (HTTP $code)"; else fail "上游异常 (HTTP $code)"; fi
else
  info "跳过(未取到 key)"
fi

# 6. 最近日志有无错误
echo "[6] 错误日志(近5条)"
if [ -f "$ERRLOG" ]; then
  n=$(wc -l <"$ERRLOG")
  echo "    日志总行数:$n; 最近错误:"
  tail -5 "$ERRLOG" | sed 's/^/      /'
else
  info "无错误日志"
fi

echo "=========================================="
echo -e "\n重启代理:      launchctl kickstart -k gui/\$(id -u)/$LABEL"
echo "查看日志:      tail -f ~/Library/Logs/codex-deepseek-proxy.log"
echo "语法检查:      /Users/fangfang/.local/bin/node --check codex-deepseek-proxy.js"
echo "=========================================="
