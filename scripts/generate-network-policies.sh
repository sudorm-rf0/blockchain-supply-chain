#!/usr/bin/env bash
# 生成按用途收紧密级的外部出口 NetworkPolicy（最小化出口）。
# 用法（OFF-NET-1：所有用途都必须收紧密级，缺任一 CIDR 即失败，不再静默宽放）：
#   SOLANA_RPC_CIDR=203.0.113.0/24 \
#   RISK_WEBHOOK_CIDR=198.51.100.5/32 \
#   S3_CIDR=192.0.2.0/24 \
#   bash scripts/generate-network-policies.sh
# 本地开发确需宽放时显式传入 ALLOW_WIDE_OPEN=1（明确不适用于生产）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-${ROOT}/k8s/network-policies.generated.yaml}"

SOLANA="${SOLANA_RPC_CIDR:-}"
WEBHOOK="${RISK_WEBHOOK_CIDR:-}"
S3="${S3_CIDR:-}"

if [[ "${ALLOW_WIDE_OPEN:-0}" != "1" ]]; then
  missing=()
  [[ -z "${SOLANA}" ]] && missing+=("SOLANA_RPC_CIDR")
  [[ -z "${WEBHOOK}" ]] && missing+=("RISK_WEBHOOK_CIDR")
  [[ -z "${S3}" ]] && missing+=("S3_CIDR")
  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "error: missing required egress CIDRs: ${missing[*]}" >&2
    echo "all external egress CIDRs must be set to enable least-privilege egress (OFF-NET-1)." >&2
    echo "for local development only, set ALLOW_WIDE_OPEN=1 to permit 0.0.0.0/0 fallback." >&2
    exit 1
  fi
fi

# 基础 CIDR 格式校验（IPv4 a.b.c.d/n 或 IPv6 段；宽放 0.0.0.0/0 在 fail-closed 下不再出现）。
validate_cidr() {
  local name="$1" value="$2"
  if [[ "${value}" == "0.0.0.0/0" || "${value}" == "::/0" ]]; then
    if [[ "${ALLOW_WIDE_OPEN:-0}" != "1" ]]; then
      echo "error: ${name}=${value} is a wide-open fallback; refusing to generate hardened policy" >&2
      exit 1
    fi
  fi
  if ! [[ "${value}" =~ ^[0-9a-fA-F:.]+/[0-9]{1,3}$ ]]; then
    echo "error: ${name}=${value} does not look like a CIDR" >&2
    exit 1
  fi
}
[[ -z "${SOLANA}" ]] || validate_cidr SOLANA_RPC_CIDR "${SOLANA}"
[[ -z "${WEBHOOK}" ]] || validate_cidr RISK_WEBHOOK_CIDR "${WEBHOOK}"
[[ -z "${S3}" ]] || validate_cidr S3_CIDR "${S3}"

# fail-closed 下不允许 0.0.0.0/0；ALLOW_WIDE_OPEN=1 时保留显式宽放行为。
SOLANA="${SOLANA:-0.0.0.0/0}"
WEBHOOK="${WEBHOOK:-0.0.0.0/0}"
S3="${S3:-0.0.0.0/0}"

TMP="${OUT}.tmp"
cat > "${TMP}" <<'EOF'
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
            cidr: __SOLANA__
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 80
    - to:
        - ipBlock:
            cidr: __WEBHOOK__
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 80
    - to:
        - ipBlock:
            cidr: __S3__
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 80
EOF
sed "s|__SOLANA__|${SOLANA}|g; s|__WEBHOOK__|${WEBHOOK}|g; s|__S3__|${S3}|g" "${TMP}" > "${OUT}"
rm "${TMP}"

echo "generated: ${OUT}"
echo "apply with: kubectl apply -f ${OUT} -n supply-chain"
echo "then remove the wide-open allow-egress-external block from k8s/network-policies.yaml (deploy.sh does this automatically when the generated file exists)"
