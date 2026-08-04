#!/usr/bin/env bash
# 生成接入真实告警渠道的 Alertmanager 配置。
# 至少配置一种渠道，可同时启用多个：
#   ALERTMANAGER_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx
#   ALERTMANAGER_SLACK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
# 可选邮件渠道：
#   ALERTMANAGER_EMAIL_TO=ops@example.com
#   ALERTMANAGER_SMTP_SMARTHOST=smtp.example.com:587
#   ALERTMANAGER_SMTP_FROM=alert@example.com
#   ALERTMANAGER_SMTP_AUTH_USERNAME=alert@example.com
#   ALERTMANAGER_SMTP_AUTH_PASSWORD=secret
#   ALERTMANAGER_SMTP_AUTH_IDENTITY= (可选)
# 可选 Slack 频道：ALERTMANAGER_SLACK_CHANNEL="#alerts"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-${ROOT}/k8s/alertmanager-config.generated.yaml}"
WEBHOOK_URL="${ALERTMANAGER_WEBHOOK_URL:-}"
SLACK_URL="${ALERTMANAGER_SLACK_URL:-}"
SLACK_CHANNEL="${ALERTMANAGER_SLACK_CHANNEL:-#alerts}"
EMAIL_TO="${ALERTMANAGER_EMAIL_TO:-}"
SMTP_SMARTHOST="${ALERTMANAGER_SMTP_SMARTHOST:-}"
SMTP_FROM="${ALERTMANAGER_SMTP_FROM:-}"
SMTP_USERNAME="${ALERTMANAGER_SMTP_AUTH_USERNAME:-}"
SMTP_PASSWORD="${ALERTMANAGER_SMTP_AUTH_PASSWORD:-}"
SMTP_IDENTITY="${ALERTMANAGER_SMTP_AUTH_IDENTITY:-}"

if [[ -z "${WEBHOOK_URL}" && -z "${SLACK_URL}" && -z "${EMAIL_TO}" ]]; then
  echo "usage: ALERTMANAGER_WEBHOOK_URL=<url> | ALERTMANAGER_SLACK_URL=<url> | ALERTMANAGER_EMAIL_TO=<to> bash scripts/configure-alertmanager-webhook.sh" >&2
  echo "at least one of ALERTMANAGER_WEBHOOK_URL / ALERTMANAGER_SLACK_URL / ALERTMANAGER_EMAIL_TO is required" >&2
  exit 2
fi

if [[ -n "${EMAIL_TO}" && ( -z "${SMTP_SMARTHOST}" || -z "${SMTP_FROM}" ) ]]; then
  echo "email channel requires ALERTMANAGER_SMTP_SMARTHOST and ALERTMANAGER_SMTP_FROM" >&2
  exit 2
fi

{
  echo "apiVersion: v1"
  echo "kind: ConfigMap"
  echo "metadata:"
  echo "  name: alertmanager-config"
  echo "data:"
  echo "  alertmanager.yml: |"
  echo "    global:"
  echo "      resolve_timeout: 5m"
  if [[ -n "${SMTP_SMARTHOST}" ]]; then
    echo "      smtp_smarthost: ${SMTP_SMARTHOST}"
    echo "      smtp_from: ${SMTP_FROM}"
    if [[ -n "${SMTP_USERNAME}" ]]; then
      echo "      smtp_auth_username: ${SMTP_USERNAME}"
    fi
    if [[ -n "${SMTP_PASSWORD}" ]]; then
      echo "      smtp_auth_password: ${SMTP_PASSWORD}"
    fi
    if [[ -n "${SMTP_IDENTITY}" ]]; then
      echo "      smtp_auth_identity: ${SMTP_IDENTITY}"
    fi
  fi
  echo "    route:"
  echo "      receiver: default"
  echo "      group_by: ['alertname', 'severity']"
  echo "      group_wait: 30s"
  echo "      group_interval: 5m"
  echo "      repeat_interval: 4h"
  echo "    receivers:"
  echo "      - name: default"
  if [[ -n "${WEBHOOK_URL}" ]]; then
    echo "        webhook_configs:"
    echo "          - url: \"${WEBHOOK_URL}\""
    echo "            send_resolved: true"
  fi
  if [[ -n "${SLACK_URL}" ]]; then
    echo "        slack_configs:"
    echo "          - api_url: \"${SLACK_URL}\""
    echo "            channel: \"${SLACK_CHANNEL}\""
    echo "            send_resolved: true"
    echo "            title: '{{ template \"slack.default.title\" . }}'"
  fi
  if [[ -n "${EMAIL_TO}" ]]; then
    echo "        email_configs:"
    echo "          - to: \"${EMAIL_TO}\""
    echo "            send_resolved: true"
  fi
} > "${OUT}"

echo "generated: ${OUT}"
echo "apply with: kubectl apply -f ${OUT} -n supply-chain"
