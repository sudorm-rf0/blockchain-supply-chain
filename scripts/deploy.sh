#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-supply-chain}"
REGISTRY="${REGISTRY:-ghcr.io/example/supply-chain}"
TAG="${TAG:-latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-${REGISTRY}-backend:${TAG}}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-${REGISTRY}-frontend:${TAG}}"
DOCKERFILE="${DOCKERFILE:-Dockerfile.multistage}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://supply-chain.example.com}"
NEXT_PUBLIC_BACKEND_URL="${NEXT_PUBLIC_BACKEND_URL:-${PUBLIC_BASE_URL}/api}"
NEXT_PUBLIC_TRADE_API_URL="${NEXT_PUBLIC_TRADE_API_URL:-${PUBLIC_BASE_URL}/api}"
NEXT_PUBLIC_POOL_API_URL="${NEXT_PUBLIC_POOL_API_URL:-${PUBLIC_BASE_URL}/api}"

SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
DEPLOY_MONITORING="${DEPLOY_MONITORING:-0}"

echo "==> [1/5] build and push images"
if [[ "${SKIP_BUILD}" != "1" ]]; then
  docker build --pull -f "${DOCKERFILE}" \
    --build-arg NEXT_PUBLIC_BACKEND_URL="${NEXT_PUBLIC_BACKEND_URL}" \
    --build-arg NEXT_PUBLIC_TRADE_API_URL="${NEXT_PUBLIC_TRADE_API_URL}" \
    --build-arg NEXT_PUBLIC_POOL_API_URL="${NEXT_PUBLIC_POOL_API_URL}" \
    --target backend-runner -t "${BACKEND_IMAGE}" .
  docker push "${BACKEND_IMAGE}"
  docker build --pull -f "${DOCKERFILE}" \
    --build-arg NEXT_PUBLIC_BACKEND_URL="${NEXT_PUBLIC_BACKEND_URL}" \
    --build-arg NEXT_PUBLIC_TRADE_API_URL="${NEXT_PUBLIC_TRADE_API_URL}" \
    --build-arg NEXT_PUBLIC_POOL_API_URL="${NEXT_PUBLIC_POOL_API_URL}" \
    --target frontend-runner -t "${FRONTEND_IMAGE}" .
  docker push "${FRONTEND_IMAGE}"
fi

echo "==> [2/5] namespace and secrets"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
if ! kubectl get secret backend-secrets -n "${NAMESPACE}" >/dev/null 2>&1; then
  echo "missing secret backend-secrets. Run scripts/create-k8s-secrets.sh first:" >&2
  echo "  NAMESPACE=${NAMESPACE} ALLOWED_ORIGIN=https://supply-chain.example.com scripts/create-k8s-secrets.sh" >&2
  exit 1
fi

echo "==> [3/5] apply manifests"
kubectl apply -n "${NAMESPACE}" -f k8s/postgres-statefulset.yaml
kubectl wait --for=condition=ready pod -l app=postgres -n "${NAMESPACE}" --timeout=300s
kubectl apply -n "${NAMESPACE}" -f k8s/redis-deployment.yaml
kubectl rollout status statefulset/redis -n "${NAMESPACE}" --timeout=300s
kubectl apply -n "${NAMESPACE}" \
  -f k8s/backend-deployment.yaml \
  -f k8s/backend-service.yaml \
  -f k8s/frontend-deployment.yaml \
  -f k8s/indexer-deployment.yaml \
  -f k8s/trade-deployment.yaml \
  -f k8s/pool-deployment.yaml \
  -f k8s/ingress.yaml
kubectl apply -n "${NAMESPACE}" -f k8s/pod-disruption-budgets.yaml
kubectl set image deployment/backend backend="${BACKEND_IMAGE}" -n "${NAMESPACE}"
kubectl set image deployment/frontend frontend="${FRONTEND_IMAGE}" -n "${NAMESPACE}"
kubectl set image deployment/indexer-service indexer-service="${BACKEND_IMAGE}" -n "${NAMESPACE}"
kubectl set image deployment/trade-service trade-service="${BACKEND_IMAGE}" -n "${NAMESPACE}"
kubectl set image deployment/pool-service pool-service="${BACKEND_IMAGE}" -n "${NAMESPACE}"
kubectl rollout status deployment/backend -n "${NAMESPACE}" --timeout=300s
kubectl rollout status deployment/frontend -n "${NAMESPACE}" --timeout=300s
kubectl rollout status deployment/indexer-service -n "${NAMESPACE}" --timeout=300s
kubectl rollout status deployment/trade-service -n "${NAMESPACE}" --timeout=300s
kubectl rollout status deployment/pool-service -n "${NAMESPACE}" --timeout=300s

echo "==> [3.5/5] apply backup cronjob"
kubectl apply -n "${NAMESPACE}" -f k8s/postgres-backup-cronjob.yaml
kubectl apply -n "${NAMESPACE}" -f k8s/postgres-backup-drill-cronjob.yaml

if [[ "${DEPLOY_MONITORING}" == "1" ]]; then
  echo "==> [3.6/5] apply monitoring stack"
  BB_TARGETS="$(mktemp /tmp/blackbox-targets.XXXXXX.yml)"
  printf -- '- targets:\n    - %s/health\n    - %s/health/ready\n    - %s/login\n' \
    "${PUBLIC_BASE_URL}" "${PUBLIC_BASE_URL}" "${PUBLIC_BASE_URL}" > "${BB_TARGETS}"
  kubectl -n "${NAMESPACE}" create configmap prometheus-config \
    --from-file=prometheus.yml=infra/prometheus/prometheus.yml \
    --from-file=alerts.yml=infra/prometheus/alerts.yml \
    --from-file=blackbox-targets.yml="${BB_TARGETS}" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "${NAMESPACE}" create configmap blackbox-exporter-config \
    --from-file=blackbox.yml=infra/blackbox/blackbox.yml \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "${NAMESPACE}" create configmap grafana-provisioning \
    --from-file=datasources/prometheus.yml=infra/grafana/provisioning/datasources/prometheus.yml \
    --from-file=dashboards/dashboards.yml=infra/grafana/provisioning/dashboards/dashboards.yml \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "${NAMESPACE}" create configmap grafana-dashboard \
    --from-file=supply-chain.json=infra/grafana/dashboards/supply-chain.json \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  ALERTMANAGER_CONFIG="k8s/alertmanager-config.yaml"
  if [[ -f "k8s/alertmanager-config.generated.yaml" ]]; then
    ALERTMANAGER_CONFIG="k8s/alertmanager-config.generated.yaml"
    echo "==> using generated Alertmanager config: ${ALERTMANAGER_CONFIG}"
  elif [[ -n "${ALERTMANAGER_WEBHOOK_URL:-}" || -n "${ALERTMANAGER_SLACK_URL:-}" || -n "${ALERTMANAGER_EMAIL_TO:-}" ]]; then
    ALERTMANAGER_CONFIG="$(mktemp /tmp/alertmanager-config.XXXXXX.yaml)"
    OUT="${ALERTMANAGER_CONFIG}" \
      ALERTMANAGER_WEBHOOK_URL="${ALERTMANAGER_WEBHOOK_URL:-}" \
      ALERTMANAGER_SLACK_URL="${ALERTMANAGER_SLACK_URL:-}" \
      ALERTMANAGER_SLACK_CHANNEL="${ALERTMANAGER_SLACK_CHANNEL:-#alerts}" \
      ALERTMANAGER_EMAIL_TO="${ALERTMANAGER_EMAIL_TO:-}" \
      ALERTMANAGER_SMTP_SMARTHOST="${ALERTMANAGER_SMTP_SMARTHOST:-}" \
      ALERTMANAGER_SMTP_FROM="${ALERTMANAGER_SMTP_FROM:-}" \
      bash scripts/configure-alertmanager-webhook.sh >/dev/null
    echo "==> generated Alertmanager config from env: ${ALERTMANAGER_CONFIG}"
  else
    echo "WARN: Alertmanager channel not configured; deploying placeholder config. Run scripts/configure-alertmanager-webhook.sh first." >&2
  fi
  kubectl apply -n "${NAMESPACE}" \
    -f "${ALERTMANAGER_CONFIG}" \
    -f k8s/prometheus-deployment.yaml \
    -f k8s/blackbox-exporter-deployment.yaml \
    -f k8s/grafana-deployment.yaml \
    -f k8s/alertmanager-deployment.yaml
  kubectl rollout status deployment/prometheus -n "${NAMESPACE}" --timeout=300s
  kubectl rollout status deployment/grafana -n "${NAMESPACE}" --timeout=300s
  kubectl rollout status deployment/alertmanager -n "${NAMESPACE}" --timeout=300s
fi

if [[ "${DEPLOY_NETWORK_POLICIES}" == "1" ]]; then
  echo "==> [3.7/5] apply network policies"
  kubectl apply -n "${NAMESPACE}" -f k8s/network-policies.yaml
fi

echo "==> [4/5] prisma migrate deploy"
if [[ "${SKIP_MIGRATE}" != "1" ]]; then
  kubectl exec deployment/backend -n "${NAMESPACE}" -- npm run prisma:deploy
fi

echo "==> [5/5] rolling restart"
kubectl rollout restart deployment/backend -n "${NAMESPACE}"
kubectl rollout status deployment/backend -n "${NAMESPACE}" --timeout=300s

echo "deployment finished: ${BACKEND_IMAGE} in namespace ${NAMESPACE}"
