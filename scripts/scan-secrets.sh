#!/usr/bin/env bash
# 扫描工作区与 Git 历史中的疑似密钥/凭据，防止敏感信息进入仓库。
# 用法：bash scripts/scan-secrets.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXCLUDE='(^|/)(node_modules|\.git|\.next|dist|target|coverage|test-results|playwright-report)(/|$)'

PATTERNS=(
  '-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
  'sk-[A-Za-z0-9_-]{20,}'
  'ghp_[A-Za-z0-9]{36}'
  'gho_[A-Za-z0-9]{36}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'AIza[0-9A-Za-z_-]{35}'
  'api-key=[A-Za-z0-9-]{24,}'
  'client_secret["\x27]?[:=]["\x27]?[A-Za-z0-9_-]{20,}'
)

findings=0
report=()

while IFS= read -r file; do
  [[ "$file" =~ $EXCLUDE ]] && continue
  for pattern in "${PATTERNS[@]}"; do
    if grep -InE "$pattern" "$file" >/dev/null 2>&1; then
      line=$(grep -InE "$pattern" "$file" | head -1 | cut -d: -f1)
      report+=("workspace:${file}:${line} matches ${pattern}")
      findings=$((findings + 1))
    fi
  done
done < <(git ls-files -co --exclude-standard | rg -v '(^|/)(\.|node_modules|dist|target)' || true)

# 已跟踪的本地环境/钱包密钥文件（dev 程序 keypair 用于可重复部署，不算敏感）
for f in $(git ls-files | rg '(\.env$|rpc\.devnet\.env$|id\.json$|^[^/]+-wallet)' || true); do
  report+=("tracked-sensitive-file:${f}")
  findings=$((findings + 1))
done

# Git 历史扫描（当前分支全部提交，排除 lockfile 与文档示例）
history_hits=$(git log --format='%H %s' --all -- ':!pnpm-lock.yaml' ':!docs/API.md' ':!docs/DEMO.md' 2>/dev/null \
  | awk '{print $1}' | while read -r commit; do
      git show "$commit" 2>/dev/null | grep -aInE 'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|api-key=[A-Za-z0-9-]{24,}' \
        && echo "$commit"
    done | head -5)
if [[ -n "${history_hits}" ]]; then
  report+=("git-history:${history_hits}")
  findings=$((findings + 1))
fi

if [[ "${findings}" -gt 0 ]]; then
  printf 'SECRET SCAN FAILED: %s finding(s)\n' "${findings}"
  printf '%s\n' "${report[@]}" | head -40
  exit 1
fi

echo "secret scan passed: no obvious secrets in workspace or history"
