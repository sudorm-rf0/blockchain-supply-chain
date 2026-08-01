#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-supply-chain}"
REGISTRY="${REGISTRY:-ghcr.io/example/supply-chain}"
TAG="${TAG:-latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-${REGISTRY}-backend:${TAG}}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-${REGISTRY}-frontend:${TAG}}"
DOCKERFILE="${DOCKERFILE:-Dockerfile.multistage}"

SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"

echo "==> [1/5] build and push images"
if [[ "${SKIP_BUILD}" != "1" ]]; then
  docker build --pull -f "${DOCKERFILE}" --target backend-runner -t "${BACKEND_IMAGE}" .
  docker push "${BACKEND_IMAGE}"
  docker build --pull -f "${DOCKERFILE}" --target frontend-runner -t "${FRONTEND_IMAGE}" .
  docker push "${FRONTEND_IMAGE}"
fi

echo "==> [2/5] namespace and secrets"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
if ! kubectl get secret backend-secrets -n "${NAMESPACE}" >/dev/null 2>&1; then
  echo "missing secret backend-secrets. Create it first:" >&2
  echo "  kubectl -n ${NAMESPACE} create secret generic backend-secrets \\" >&2
  echo "    --from-literal=DATABASE_URL=postgresql://user:pass@postgres:5432/supply_chain \\" >&2
  echo "    --from-literal=REDIS_URL=redis://:password@redis:6379 \\" >&2
  echo "    --from-literal=JWT_SECRET=$(openssl rand -hex 32) \\" >&2
  echo "    --from-literal=SOLANA_RPC_URL=https://api.devnet.solana.com \\" >&2
  echo "    --from-literal=ALLOWED_ORIGIN=https://supply-chain.example.com \\" >&2
  echo "    --from-literal=POSTGRES_USER=postgres \\" >&2
  echo "    --from-literal=POSTGRES_PASSWORD=$(openssl rand -hex 16) \\" >&2
  echo "    --from-literal=POSTGRES_DB=supply_chain" >&2
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

echo "==> [4/5] prisma migrate deploy"
if [[ "${SKIP_MIGRATE}" != "1" ]]; then
  kubectl exec deployment/backend -n "${NAMESPACE}" -- npm run prisma:deploy
fi

echo "==> [5/5] rolling restart"
kubectl rollout restart deployment/backend -n "${NAMESPACE}"
kubectl rollout status deployment/backend -n "${NAMESPACE}" --timeout=300s

echo "deployment finished: ${BACKEND_IMAGE} in namespace ${NAMESPACE}"
