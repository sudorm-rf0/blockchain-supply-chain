#!/usr/bin/env bash
# Monitoring verification: alert rules, service /metrics endpoints, optional
# Prometheus / Alertmanager / Grafana connectivity. Outputs a JSON report.
#
# Usage: bash scripts/verify-monitoring.sh
# Env:
#   SERVICES="3001 backend,3003 indexer,3004 trade,3005 pool"
#   PROMETHEUS_URL=http://prometheus:9090   (optional live check)
#   GRAFANA_URL=http://grafana:3000         (optional live check)
#   REPORT_PATH=/tmp/monitoring-verify-report.json
set -euo pipefail

SERVICES="${SERVICES:-3001 backend,3003 indexer,3004 trade,3005 pool}"
ALERTS_FILE="${ALERTS_FILE:-infra/prometheus/alerts.yml}"
REPORT_PATH="${REPORT_PATH:-/tmp/monitoring-verify-report.json}"

checks=()

add_check() {
  local name="$1"
  local status="$2"
  local detail="$3"
  checks+=("$(jq -cn --arg name "${name}" --arg status "${status}" --arg detail "${detail}" \
    '{name: $name, status: $status, detail: $detail}')")
}

validate_alerts() {
  local status="PASS"
  local detail=""
  if ! command -v promtool >/dev/null 2>&1; then
    detail="promtool not found; skipped rule syntax check"
    add_check "alert-rules-syntax" "SKIP" "${detail}"
    return 0
  fi
  local out
  if out="$(promtool check rules "${ALERTS_FILE}" 2>&1)"; then
    add_check "alert-rules-syntax" "PASS" "${out}"
  else
    add_check "alert-rules-syntax" "FAIL" "${out}"
  fi

  local alert_count
  alert_count="$(rg -c '^\s+- alert:' "${ALERTS_FILE}" || true)"
  if [[ "${alert_count}" -ge 1 ]]; then
    add_check "alert-rule-count" "PASS" "${alert_count} alerts defined"
  else
    add_check "alert-rule-count" "FAIL" "no alerts found in ${ALERTS_FILE}"
  fi
}

validate_recording_rules() {
  local status="PASS"
  local detail=""
  local file="infra/prometheus/rules.yml"
  if ! command -v promtool >/dev/null 2>&1; then
    add_check "recording-rules-syntax" "SKIP" "promtool not found"
    return 0
  fi
  if out="$(promtool check rules "${file}" 2>&1)"; then
    add_check "recording-rules-syntax" "PASS" "${out}"
  else
    add_check "recording-rules-syntax" "FAIL" "${out}"
  fi
}

check_service_metrics() {
  IFS=',' read -r -a entries <<< "${SERVICES}"
  for entry in "${entries[@]}"; do
    entry="$(printf '%s' "${entry}" | xargs)"
    port="${entry%% *}"
    name="${entry#* }"
    local url="http://localhost:${port}/metrics"
    local body
    if ! body="$(curl -sf --max-time 10 "${url}" 2>/dev/null)"; then
      add_check "metrics:${name}" "FAIL" "${url} unreachable"
      continue
    fi
    if printf '%s' "${body}" | rg -q '^# HELP http_requests_total ' && \
       printf '%s' "${body}" | rg -q '^# HELP http_request_duration_seconds ' && \
       printf '%s' "${body}" | rg -q '^# HELP process_start_time_seconds '; then
      if [[ "${name}" == "backend" ]] && ! printf '%s' "${body}" | rg -q '^# HELP csp_violations_total '; then
        add_check "metrics:${name}" "FAIL" "${url} missing csp_violations_total metric"
        continue
      fi
      add_check "metrics:${name}" "PASS" "${url} exposes http/process/csp metrics"
    else
      add_check "metrics:${name}" "FAIL" "${url} missing expected metric families"
    fi
  done
}

check_prometheus_config() {
  local cfg="${PROMETHEUS_CONFIG:-infra/prometheus/prometheus.yml}"
  if rg -q "alertmanager:9093" "${cfg}"; then
    add_check "prometheus-alertmanager-link" "PASS" "${cfg} routes alerts to alertmanager:9093"
  else
    add_check "prometheus-alertmanager-link" "FAIL" "${cfg} missing alertmanager:9093 target"
  fi
  if rg -q "blackbox-exporter:9115" "${cfg}"; then
    add_check "prometheus-blackbox-link" "PASS" "${cfg} routes probes to blackbox-exporter:9115"
  else
    add_check "prometheus-blackbox-link" "FAIL" "${cfg} missing blackbox-exporter:9115 target"
  fi
  if [[ -f "infra/blackbox/blackbox.yml" ]] && rg -q "http_2xx:" "infra/blackbox/blackbox.yml"; then
    add_check "blackbox-config" "PASS" "infra/blackbox/blackbox.yml defines http_2xx module"
  else
    add_check "blackbox-config" "FAIL" "infra/blackbox/blackbox.yml missing http_2xx module"
  fi
}

check_prometheus() {
  if [[ -z "${PROMETHEUS_URL:-}" ]]; then
    add_check "prometheus-live" "SKIP" "PROMETHEUS_URL not set"
    return 0
  fi
  local rules
  if rules="$(curl -sf --max-time 10 "${PROMETHEUS_URL}/api/v1/rules" 2>/dev/null)"; then
    local rule_count
    rule_count="$(printf '%s' "${rules}" | jq '.data.groups | map(.rules | length) | add // 0')"
    add_check "prometheus-live" "PASS" "${rule_count} rules loaded"
  else
    add_check "prometheus-live" "FAIL" "${PROMETHEUS_URL} unreachable"
  fi
}

check_grafana() {
  if [[ -z "${GRAFANA_URL:-}" ]]; then
    add_check "grafana-live" "SKIP" "GRAFANA_URL not set"
    return 0
  fi
  local health
  if health="$(curl -sf --max-time 10 "${GRAFANA_URL}/api/health" 2>/dev/null)"; then
    add_check "grafana-live" "PASS" "$(printf '%s' "${health}" | jq -c '{database, version}')"
  else
    add_check "grafana-live" "FAIL" "${GRAFANA_URL} unreachable"
  fi
}

start_ts="$(date +%s)"
validate_alerts
validate_recording_rules
check_service_metrics
check_prometheus_config
check_prometheus
check_grafana
duration="$(( $(date +%s) - start_ts ))"

failures="$(printf '%s\n' "${checks[@]}" | jq -r 'select(.status == "FAIL") | .name' | wc -l | tr -d '[:space:]')"
ok="true"
if [[ "${failures}" -gt 0 ]]; then
  ok="false"
fi

checks_json="$(printf '%s\n' "${checks[@]}" | jq -s .)"
jq -n \
  --argjson ok "${ok}" \
  --argjson duration "${duration}" \
  --argjson checks "${checks_json}" \
  '{ok: $ok, durationSeconds: $duration, checks: $checks}' \
  > "${REPORT_PATH}"

echo "----------------------------------------"
echo "monitoring verification report: ${REPORT_PATH}"
cat "${REPORT_PATH}"
echo "----------------------------------------"

if [[ "${ok}" == "true" ]]; then
  echo "monitoring verification passed"
else
  echo "monitoring verification FAILED" >&2
  exit 1
fi
