#!/usr/bin/env bash
# 上传前端 source maps 到 Sentry（可选）。
# Env: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_RELEASE
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${SENTRY_AUTH_TOKEN:-}" || -z "${SENTRY_ORG:-}" || -z "${SENTRY_PROJECT:-}" || -z "${SENTRY_RELEASE:-}" ]]; then
  echo "usage: SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=... SENTRY_RELEASE=... bash scripts/upload-sourcemaps.sh" >&2
  exit 2
fi

cd "${ROOT}/packages/frontend"
pnpm exec sentry-cli releases files "${SENTRY_RELEASE}" upload-sourcemaps .next/static --org "${SENTRY_ORG}" --project "${SENTRY_PROJECT}" --url-prefix "~/_next/static" --validate
echo "source maps uploaded for ${SENTRY_RELEASE}"
