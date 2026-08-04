#!/usr/bin/env bash
# 生成按用途收紧密级的外部出口 NetworkPolicy。
# 用法：
#   SOLANA_RPC_CIDR=203.0.113.0/24 \
#   RISK_WEBHOOK_CIDR=198.51.100.5/32 \
#   S3_CIDR=192.0.2.0/24 \
#   bash scripts/generate-network-policies.sh
# 未配置的用途回退到 0.0.0.0/0（宽放）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-${ROOT}/k8s/network-policies.generated.yaml}"

SOLANA="${SOLANA_RPC_CIDR:-0.0.0.0/0}"
WEBHOOK="${RISK_WEBHOOK_CIDR:-0.0.0.0/0}"
S3="${S3_CIDR:-0.0.0.0/0}"

cat > "${OUT}" <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-egress-external-hardened
spec:
  podSelector:
    matchLabels:
      app: supply-chain
  policyTypes: ["Egress"]
  egress:
    - to:
        - ipBlock:
            cidr: ${SOLANA}
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 80
    - to:
        - ipBlock:
            cidr: ${WEBHOOK}
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 80
    - to:
        - ipBlock:
            cidr: ${S3}
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 80
EOF

echo "generated: ${OUT}"
echo "apply with: kubectl apply -f ${OUT} -n supply-chain"
echo "then remove the wide-open allow-egress-external block from k8s/network-policies.yaml"
