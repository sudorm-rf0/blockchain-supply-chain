#!/usr/bin/env bash
# 生成项目 SBOM（CycloneDX JSON）。
# 用法：bash scripts/generate-sbom.sh
# Env: SBOM_OUT=/tmp/sbom.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SBOM_OUT="${SBOM_OUT:-${ROOT}/sbom.json}"

cd "${ROOT}"
pnpm dlx @cyclonedx/cyclonedx-npm --output-file "${SBOM_OUT}"
echo "SBOM written: ${SBOM_OUT}"
