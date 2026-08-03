#!/usr/bin/env bash
# 生成可用的 Alertmanager 配置，把占位 webhook 替换为真实告警渠道。
# 用法：ALERTMANAGER_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=xxx" \
#         bash scripts/configure-alertmanager-webhook.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-${ROOT}/k8s/alertmanager-config.generated.yaml}"
URL="${ALERTMANAGER_WEBHOOK_URL:-${1:-}}"

if [[ -z "${URL}" ]]; then
  echo "usage: ALERTMANAGER_WEBHOOK_URL=<url> bash scripts/configure-alertmanager-webhook.sh" >&2
  exit 2
fi

cat > "${OUT}" <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: alertmanager-config
data:
  alertmanager.yml: |
    global:
      resolve_timeout: 5m
    route:
      receiver: default
    receivers:
      - name: default
        webhook_configs:
          - url: ${URL}
            send_resolved: true
EOF

echo "generated: ${OUT}"
echo "apply with: kubectl apply -f ${OUT} -n supply-chain"
