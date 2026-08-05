#!/usr/bin/env bash
# 回滚演练：默认 dry-run 校验上一版镜像存在且可回滚；DRY_RUN=0 执行 rollout undo。
# 用法：PREVIOUS_TAG=v1.0.0 bash scripts/rollback-drill.sh
# Env:
#   NAMESPACE=supply-chain
#   DEPLOYMENT=backend
#   REGISTRY=your-registry/supply-chain
#   PREVIOUS_TAG=...（必填）
#   DRY_RUN=1（默认只校验不执行）
#   BACKEND_URL=https://your-domain（DRY_RUN=0 时做健康检查）
#   REPORT_PATH=/tmp/rollback-drill-report.json
set -euo pipefail

NAMESPACE="${NAMESPACE:-supply-chain}"
DEPLOYMENT="${DEPLOYMENT:-backend}"
REGISTRY="${REGISTRY:-ghcr.io/example/supply-chain}"
PREVIOUS_TAG="${PREVIOUS_TAG:-}"
DRY_RUN="${DRY_RUN:-1}"
BACKEND_URL="${BACKEND_URL:-}"
REPORT_PATH="${REPORT_PATH:-/tmp/rollback-drill-report.json}"

if [[ -z "${PREVIOUS_TAG}" ]]; then
  echo "usage: PREVIOUS_TAG=<tag> bash scripts/rollback-drill.sh" >&2
  exit 2
fi

PREVIOUS_IMAGE="${REGISTRY}-${DEPLOYMENT}:${PREVIOUS_TAG}"
checks=()

add_check() {
  local name="$1" status="$2" detail="$3"
  checks+=("$(jq -cn --arg name "${name}" --arg status "${status}" --arg detail "${detail}" \
    '{name: $name, status: $status, detail: $detail}')")
}

start_ts="$(date +%s)"

echo "=== rollback drill $(date -u +%Y-%m-%dT%H:%M:%SZ) deployment=${DEPLOYMENT} image=${PREVIOUS_IMAGE} ==="

# --------------- 前置校验 ---------------
if command -v docker >/dev/null 2>&1; then
  if docker manifest inspect --insecure "${PREVIOUS_IMAGE}" >/dev/null 2>&1; then
    add_check "previous image exists" "PASS" "${PREVIOUS_IMAGE}"
  else
    add_check "previous image exists" "FAIL" "${PREVIOUS_IMAGE} not found"
  fi
else
  add_check "previous image exists" "SKIP" "docker not available; assume tag ${PREVIOUS_TAG} exists"
fi

if command -v kubectl >/dev/null 2>&1; then
  if kubectl get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" >/dev/null 2>&1; then
    CURRENT_IMAGE="$(kubectl get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" -o jsonpath='{.spec.template.spec.containers[0].image}')"
    add_check "current deployment found" "PASS" "current image ${CURRENT_IMAGE}"
  else
    add_check "current deployment found" "FAIL" "${DEPLOYMENT} not found in ${NAMESPACE}"
  fi
else
  add_check "current deployment found" "SKIP" "kubectl not available"
fi

# --------------- 执行回滚（可选） ---------------
if [[ "${DRY_RUN}" == "0" ]]; then
  echo "==> rolling back ${DEPLOYMENT} to ${PREVIOUS_IMAGE}"
  kubectl -n "${NAMESPACE}" set image "deployment/${DEPLOYMENT}" \
    "${DEPLOYMENT}=${PREVIOUS_IMAGE}"
  if kubectl -n "${NAMESPACE}" rollout status "deployment/${DEPLOYMENT}" --timeout=300s; then
    add_check "rollout status" "PASS" "${DEPLOYMENT} rolled back to ${PREVIOUS_IMAGE}"
  else
    add_check "rollout status" "FAIL" "rollout did not become ready"
  fi
  if [[ -n "${BACKEND_URL}" ]]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${BACKEND_URL}/health" 2>/dev/null || echo 000)"
    if [[ "${code}" == "200" ]]; then
      add_check "post-rollback health" "PASS" "HTTP ${code}"
    else
      add_check "post-rollback health" "FAIL" "HTTP ${code}, expected 200"
    fi
  fi
else
  add_check "rollout execution" "SKIP" "DRY_RUN=1; run DRY_RUN=0 to actually roll back"
fi

duration="$(( $(date +%s) - start_ts ))"
failures="$(printf '%s\n' "${checks[@]}" | jq -r 'select(.status == "FAIL") | .name' | wc -l | tr -d '[:space:]')"
ok="true"
if [[ "${failures}" -gt 0 ]]; then ok="false"; fi

checks_json="$(printf '%s\n' "${checks[@]}" | jq -s .)"
jq -n \
  --arg deployment "${DEPLOYMENT}" \
  --arg image "${PREVIOUS_IMAGE}" \
  --argjson dryRun "${DRY_RUN}" \
  --argjson ok "${ok}" \
  --argjson duration "${duration}" \
  --argjson checks "${checks_json}" \
  '{ok: $ok, dryRun: $dryRun, deployment: $deployment, image: $image, durationSeconds: $duration, checks: $checks}' \
  > "${REPORT_PATH}"

echo "----------------------------------------"
echo "rollback drill report: ${REPORT_PATH}"
cat "${REPORT_PATH}"
echo "----------------------------------------"

if [[ "${ok}" == "true" ]]; then
  echo "rollback drill passed (dry-run)"
else
  echo "rollback drill FAILED" >&2
  exit 1
fi
