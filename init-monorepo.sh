#!/usr/bin/env bash
# ============================================================
# Blockchain Supply Chain Monorepo initializer
# Generates env files, the Solana program keypair, installs
# dependencies, and optionally starts infra / builds packages.
#
# Usage:
#   ./init-monorepo.sh                 # env files + keypair + pnpm install
#   ./init-monorepo.sh --infra         # also run docker compose up -d
#   ./init-monorepo.sh --build         # also run turbo build + anchor build
#   ./init-monorepo.sh --skip-install  # skip pnpm install
# ============================================================
set -euo pipefail

# ==== 分段标识: 常量与参数解析 ====
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANCHOR_TOML="$ROOT_DIR/packages/contracts/Anchor.toml"

START_INFRA=0
RUN_BUILD=0
SKIP_INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --infra) START_INFRA=1 ;;
    --build) RUN_BUILD=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    *)
      printf "unknown option: %s\n" "$arg" >&2
      exit 1
      ;;
  esac
done

# ==== 分段标识: 工具检查 ====
check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "missing command: %s\n" "$1" >&2
    exit 1
  fi
}

check_command node
check_command pnpm

ANCHOR_AVAILABLE=0
SOLANA_AVAILABLE=0
DOCKER_AVAILABLE=0
command -v anchor >/dev/null 2>&1 && ANCHOR_AVAILABLE=1
command -v solana >/dev/null 2>&1 && SOLANA_AVAILABLE=1
command -v docker >/dev/null 2>&1 && DOCKER_AVAILABLE=1

printf "[1/5] tools: node/pnpm ok"
if [[ "$ANCHOR_AVAILABLE" -eq 0 ]]; then
  printf ", anchor missing"
fi
if [[ "$SOLANA_AVAILABLE" -eq 0 ]]; then
  printf ", solana missing"
fi
if [[ "$DOCKER_AVAILABLE" -eq 0 ]]; then
  printf ", docker missing"
fi
printf "\n"

# ==== 分段标识: 环境文件 ====
ensure_env_file() {
  local package_dir="$1"
  if [[ ! -f "$package_dir/.env" ]]; then
    cp "$package_dir/.env.example" "$package_dir/.env"
    printf "[2/5] created %s\n" "$package_dir/.env"
  else
    printf "[2/5] kept existing %s\n" "$package_dir/.env"
  fi
}
ensure_env_file "$ROOT_DIR/packages/backend"
ensure_env_file "$ROOT_DIR/packages/frontend"

# ==== 分段标识: 依赖安装 ====
if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  printf "[3/5] running pnpm install\n"
  (cd "$ROOT_DIR" && pnpm install)
else
  printf "[3/5] skipped pnpm install\n"
fi

# ==== 分段标识: 程序密钥生成 ====
PROGRAM_ENTRIES=(
  "supply_chain:programs/supply-chain"
  "trade_finance:programs/trade-finance"
)

for entry in "${PROGRAM_ENTRIES[@]}"; do
  lib_name="${entry%%:*}"
  program_dir="${entry##*:}"
  keypair_path="$ROOT_DIR/packages/contracts/target/deploy/${lib_name}-keypair.json"
  lib_file="$ROOT_DIR/packages/contracts/${program_dir}/src/lib.rs"

  if [[ -f "$keypair_path" ]]; then
    PROGRAM_ID="$(node "$ROOT_DIR/scripts/keygen.cjs" --read "$keypair_path")"
    printf "[4/5] reuse program keypair (%s): %s\n" "$lib_name" "$PROGRAM_ID"
  else
    PROGRAM_ID="$(node "$ROOT_DIR/scripts/keygen.cjs" "$keypair_path")"
    printf "[4/5] generated program keypair (%s): %s\n" "$lib_name" "$PROGRAM_ID"
  fi

  perl -pi -e "s/declare_id!\(\"[A-Za-z0-9]+\"\)/declare_id!(\"$PROGRAM_ID\")/" "$lib_file"
  perl -pi -e "s/^${lib_name} = \".+\"$/${lib_name} = \"$PROGRAM_ID\"/" "$ANCHOR_TOML"
done

# ==== 分段标识: 构建与基础设施 ====
if [[ "$RUN_BUILD" -eq 1 ]]; then
  printf "[5/5] running turbo build\n"
  (cd "$ROOT_DIR" && pnpm exec turbo run build \
    --filter=@supply-chain/backend \
    --filter=@supply-chain/frontend)
  if [[ "$ANCHOR_AVAILABLE" -eq 1 ]]; then
    (cd "$ROOT_DIR/packages/contracts" && anchor build)
  else
    printf "skipped anchor build: anchor-cli not installed\n" >&2
  fi
else
  printf "[5/5] skipped build (use --build to enable)\n"
fi

if [[ "$START_INFRA" -eq 1 ]]; then
  if [[ "$DOCKER_AVAILABLE" -eq 1 ]]; then
    (cd "$ROOT_DIR" && docker compose up -d)
  else
    printf "skipped docker compose: docker not installed\n" >&2
  fi
fi

# ==== 分段标识: 收尾 ====
cat <<EOF

Initialization finished.

Local development:
  docker compose up -d
  pnpm --filter backend run prisma:generate
  pnpm dev

Contract deployment (requires anchor-cli + solana-cli):
  cd packages/contracts && anchor build && cargo build-sbf --arch v3
  solana program deploy target/deploy/trade_finance.so --program-id target/deploy/trade_finance-keypair.json
  solana program deploy target/deploy/supply_chain.so --program-id target/deploy/supply_chain-keypair.json

Manual steps:
  - Install Anchor CLI 0.31.1: cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.1 anchor-cli --locked
  - Install Agave CLI 4.1.2 (release tarball from github.com/anza-xyz/agave) and create ~/.config/solana/id.json
  - localnet: docker compose up -d solana-localnet (builds Agave 4.1.2 image)
  - deploy: cd packages/contracts && cargo build-sbf --arch v3 && solana program deploy ...
  - Anchor.toml wallet points to ~/.config/solana/id.json
EOF
