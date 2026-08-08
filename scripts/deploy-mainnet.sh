#!/usr/bin/env bash
# 主网合约部署（真实资金环境，操作不可逆！）
#
# 用法：
#   bash scripts/deploy-mainnet.sh --yes                # 部署（必须先显式确认）
#   bash scripts/deploy-mainnet.sh --yes --generate-keypairs   # 自动生成全新 Program keypair
#   bash scripts/deploy-mainnet.sh --dry-run --yes      # 只打印命令不执行
#   bash scripts/deploy-mainnet.sh --yes --freeze-upgrade-authority  # 部署后冻结升级权限
#   bash scripts/deploy-mainnet.sh --yes --upgrade-authority <MULTISIG_PDA>  # 部署后把 UA 交给多签（N-03 推荐）
#
# 环境变量（必填，见 infra/config/production.env.example）：
#   SOLANA_RPC_URL         主网 RPC（拒绝 localhost/devnet）
#   DEPLOY_WALLET          主网部署钱包（建议独立冷钱包）
#   USDC_MINT / LP_MINT    主网代币（LP mint authority 需已交多签）
# 可选：
#   TRADE_KEYPAIR / SUPPLY_KEYPAIR    Program keypair 路径（默认 target/deploy/mainnet/*-keypair.json）
#   MIN_BALANCE_SOL        预检最低余额（默认 2）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
export PATH="${SOLANA_BIN}:$HOME/.cargo/bin:$PATH"

CONFIRM=0
DRY_RUN=0
GENERATE_KEYS=0
FREEZE=0
MULTISIG_PDA=""
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRM=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --generate-keypairs) GENERATE_KEYS=1 ;;
    --freeze-upgrade-authority) FREEZE=1 ;;
    --upgrade-authority) [[ $# -ge 2 ]] && { MULTISIG_PDA="$2"; shift; } || { echo "--upgrade-authority needs an arg" >&2; exit 1; } ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

TRADE_KEYPAIR="${TRADE_KEYPAIR:-${ROOT}/packages/contracts/target/deploy/mainnet/trade_finance-keypair.json}"
SUPPLY_KEYPAIR="${SUPPLY_KEYPAIR:-${ROOT}/packages/contracts/target/deploy/mainnet/supply_chain-keypair.json}"
LOG_FILE="${LOG_FILE:-/tmp/deploy-mainnet-$(date +%Y%m%d-%H%M%S).log}"

log() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "${LOG_FILE}"; }

# ---------- 1. 不可逆确认 ----------
if [[ "${CONFIRM}" != "1" ]]; then
  echo "❌ 这是【主网】部署，操作不可逆。必须显式传 --yes 确认。" >&2
  echo "   先用 --dry-run 预览将执行的命令。" >&2
  exit 1
fi

# ---------- 2. 环境变量校验 ----------
: "${SOLANA_RPC_URL:?必须设置 SOLANA_RPC_URL（主网）}"
: "${DEPLOY_WALLET:?必须设置 DEPLOY_WALLET（主网部署钱包）}"
: "${USDC_MINT:?必须设置 USDC_MINT（主网 USDC）}"
: "${LP_MINT:?必须设置 LP_MINT（主网 LP，authority 需已交多签）}"

case "${SOLANA_RPC_URL}" in
  *localhost*|*127.0.0.1*|*devnet*) echo "❌ SOLANA_RPC_URL 不能是 localhost/devnet：${SOLANA_RPC_URL}" >&2; exit 1 ;;
esac

command -v anchor >/dev/null || { echo "anchor CLI not found" >&2; exit 1; }
command -v solana >/dev/null || { echo "solana CLI not found" >&2; exit 1; }

# ---------- 3. Program keypair ----------
if [[ "${GENERATE_KEYS}" == "1" ]]; then
  mkdir -p "$(dirname "${TRADE_KEYPAIR}")" "$(dirname "${SUPPLY_KEYPAIR}")"
  [[ -f "${TRADE_KEYPAIR}" ]] && { echo "❌ keypair 已存在：${TRADE_KEYPAIR}（不会覆盖）" >&2; exit 1; }
  [[ -f "${SUPPLY_KEYPAIR}" ]] && { echo "❌ keypair 已存在：${SUPPLY_KEYPAIR}（不会覆盖）" >&2; exit 1; }
  echo "==> 生成全新主网 Program keypair（离线保管备份！）"
  solana-keygen new --no-bip39-passphrase --force -o "${TRADE_KEYPAIR}"
  solana-keygen new --no-bip39-passphrase --force -o "${SUPPLY_KEYPAIR}"
else
  for kp in "${TRADE_KEYPAIR}" "${SUPPLY_KEYPAIR}"; do
    [[ -f "${kp}" ]] || { echo "❌ 缺少 Program keypair：${kp}（用 --generate-keypairs 生成）" >&2; exit 1; }
  done
fi

TRADE_PROGRAM_ID="$(solana-keygen pubkey "${TRADE_KEYPAIR}")"
SUPPLY_PROGRAM_ID="$(solana-keygen pubkey "${SUPPLY_KEYPAIR}")"
# 禁止使用 devnet 占位 ID
if [[ "${TRADE_PROGRAM_ID}" == "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3" || \
      "${SUPPLY_PROGRAM_ID}" == "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk" ]]; then
  echo "❌ Program ID 仍是 devnet 占位 ID，主网禁止使用" >&2
  exit 1
fi

log "==> 主网部署计划"
log "  RPC:        ${SOLANA_RPC_URL}"
log "  钱包:       ${DEPLOY_WALLET}"
log "  trade:      ${TRADE_PROGRAM_ID}  (keypair ${TRADE_KEYPAIR})"
log "  supply:     ${SUPPLY_PROGRAM_ID}  (keypair ${SUPPLY_KEYPAIR})"
log "  USDC/LP:    ${USDC_MINT} / ${LP_MINT}"
log "  freeze:     ${FREEZE}"
echo "----------------------------------------"
echo "以上信息已写入日志：${LOG_FILE}"
echo "确认无误？主网部署不可回滚。5 秒后继续（Ctrl-C 取消）..."
sleep 5

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "==> [dry-run] 以下命令将被执行（未真正部署）："
  cat <<CMDS
  bash ${ROOT}/scripts/precheck-mainnet-deploy.sh
  (cd ${ROOT}/packages/contracts && anchor build && cargo build-sbf --arch v3)
  solana program deploy ${ROOT}/packages/contracts/target/deploy/trade_finance.so --program-id ${TRADE_KEYPAIR}
  solana program deploy ${ROOT}/packages/contracts/target/deploy/supply_chain.so --program-id ${SUPPLY_KEYPAIR}
  bash ${ROOT}/scripts/verify-contract-deployment.sh
  # optional: solana program set-upgrade-authority <PID> --new-upgrade-authority <MULTISIG_PDA>
CMDS
  exit 0
fi

# ---------- 3.5 审计 M-05：declare_id! 与部署 keypair 的 Program ID 必须一致 ----------
# 主网 Program ID 由部署 keypair 决定；字节码中 declare_id!（crate::ID）必须与之一致，
# 否则 C-1 的 program_data PDA 绑定、全部 PDA 派生（pool/authority/registry）与客户端
# 调用都会按旧 ID 计算 → 主网程序不可用。--generate-keypairs 生成新 keypair 后自动同步。
if [[ "${GENERATE_KEYS}" == "1" ]]; then
  log "==> [M-05] 同步 declare_id! / Anchor.toml 到新 Program ID"
  for spec in "trade_finance:${TRADE_KEYPAIR}" "supply_chain:${SUPPLY_KEYPAIR}"; do
    name="${spec%%:*}"; kp="${spec#*:}"
    id="$(solana-keygen pubkey "${kp}")"
    lib="${ROOT}/packages/contracts/programs/${name}/src/lib.rs"
    sed -i '' "s|declare_id!("[1-9A-HJ-NP-Za-km-z]*")|declare_id!("${id}")|" "${lib}"
  done
  TRADE_ID="$(solana-keygen pubkey "${TRADE_KEYPAIR}")"
  SUPPLY_ID="$(solana-keygen pubkey "${SUPPLY_KEYPAIR}")"
  perl -pi -e "s/trade_finance = \"[1-9A-HJ-NP-Za-km-z]*\"/trade_finance = \"${TRADE_ID}\"/g" "${ROOT}/packages/contracts/Anchor.toml"
  perl -pi -e "s/supply_chain = \"[1-9A-HJ-NP-Za-km-z]*\"/supply_chain = \"${SUPPLY_ID}\"/g" "${ROOT}/packages/contracts/Anchor.toml"
  log "  trade_finance -> ${TRADE_ID}"
  log "  supply_chain  -> ${SUPPLY_ID}"
fi
TRADE_DECLARE_ID="$(grep -oE 'declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\)' "${ROOT}/packages/contracts/programs/trade-finance/src/lib.rs" | grep -oE '"[1-9A-HJ-NP-Za-km-z]{32,44}"' | tr -d '"')"
SUPPLY_DECLARE_ID="$(grep -oE 'declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\)' "${ROOT}/packages/contracts/programs/supply-chain/src/lib.rs" | grep -oE '"[1-9A-HJ-NP-Za-km-z]{32,44}"' | tr -d '"')"
if [[ "${TRADE_DECLARE_ID}" != "${TRADE_PROGRAM_ID}" || "${SUPPLY_DECLARE_ID}" != "${SUPPLY_PROGRAM_ID}" ]]; then
  echo "❌ [M-05] declare_id! 与部署 keypair ID 不一致：" >&2
  echo "   trade_finance: declare_id!(${TRADE_DECLARE_ID}) vs keypair(${TRADE_PROGRAM_ID})" >&2
  echo "   supply_chain:  declare_id!(${SUPPLY_DECLARE_ID}) vs keypair(${SUPPLY_PROGRAM_ID})" >&2
  echo "   请使用 --generate-keypairs（脚本自动同步）或先手动 anchor keys sync 再部署。" >&2
  exit 1
fi

# ---------- 4. 主网预检（强制） ----------
log "==> [1/6] 主网预检"
SOLANA_RPC_URL="${SOLANA_RPC_URL}" DEPLOY_WALLET="${DEPLOY_WALLET}" \
TRADE_FINANCE_PROGRAM_ID="${TRADE_PROGRAM_ID}" SUPPLY_CHAIN_PROGRAM_ID="${SUPPLY_PROGRAM_ID}" \
USDC_MINT="${USDC_MINT}" LP_MINT="${LP_MINT}" \
MIN_BALANCE_SOL="${MIN_BALANCE_SOL:-2}" EXPECT_POOL="${EXPECT_POOL:-absent}" \
bash "${ROOT}/scripts/precheck-mainnet-deploy.sh" | tee -a "${LOG_FILE}"

# ---------- 5. 构建 ----------
log "==> [2/6] 构建合约（anchor + cargo build-sbf v3）"
cd "${ROOT}/packages/contracts"
anchor build 2>&1 | tee -a "${LOG_FILE}"
cargo build-sbf --arch v3 2>&1 | tail -3 | tee -a "${LOG_FILE}"

# ---------- 6. 部署 ----------
log "==> [3/6] 部署 trade_finance (${TRADE_PROGRAM_ID})"
solana program deploy target/deploy/trade_finance.so \
  --program-id "${TRADE_KEYPAIR}" --url "${SOLANA_RPC_URL}" 2>&1 | tee -a "${LOG_FILE}"

log "==> [4/6] 部署 supply_chain (${SUPPLY_PROGRAM_ID})"
solana program deploy target/deploy/supply_chain.so \
  --program-id "${SUPPLY_KEYPAIR}" --url "${SOLANA_RPC_URL}" 2>&1 | tee -a "${LOG_FILE}"

# ---------- 7. 把 upgrade authority 交给多签（可选，N-03） ----------
if [[ -n "${MULTISIG_PDA}" ]]; then
  log "==> [7/8] 把 upgrade authority 交给多签 ${MULTISIG_PDA}"
  solana program set-upgrade-authority "${TRADE_PROGRAM_ID}" --new-upgrade-authority "${MULTISIG_PDA}" --url "${SOLANA_RPC_URL}" 2>&1 | tee -a "${LOG_FILE}"
  solana program set-upgrade-authority "${SUPPLY_PROGRAM_ID}" --new-upgrade-authority "${MULTISIG_PDA}" --url "${SOLANA_RPC_URL}" 2>&1 | tee -a "${LOG_FILE}"
  log "  UA 已移交多签；后续初始化需由多签执行（见 Squads 手册场景 A）"
fi

# ---------- 8. 冻结升级权限（可选，与 UA=多签互斥） ----------
if [[ "${FREEZE}" == "1" ]]; then
  log "==> [5/6] 冻结 upgrade authority（--final，不可逆）"
  # 独立复测 M-3：冻结（UA=None）后生产路径拒绝初始化（N-05），
  # 必须先完成资金池/注册中心初始化再冻结，否则部署变砖。
  POOL_PDA="$(node -e "const {PublicKey}=require('${ROOT}/node_modules/@solana/web3.js');const p=new PublicKey('${TRADE_PROGRAM_ID}');console.log(PublicKey.findProgramAddressSync([Buffer.from('trade_finance'),Buffer.from('pool')],p)[0].toBase58())")"
  REG_PDA="$(node -e "const {PublicKey}=require('${ROOT}/node_modules/@solana/web3.js');const p=new PublicKey('${SUPPLY_PROGRAM_ID}');console.log(PublicKey.findProgramAddressSync([Buffer.from('supply_chain'),Buffer.from('registry')],p)[0].toBase58())")"
  for entry in "资金池:${POOL_PDA}" "注册中心:${REG_PDA}"; do
    NAME="${entry%%:*}"; PDA="${entry##*:}"
    if ! solana account "${PDA}" --url "${SOLANA_RPC_URL}" --output json >/dev/null 2>&1; then
      echo "❌ [M-3] 冻结前必须先初始化${NAME}（${PDA}）链上不存在；请先运行 init-mainnet 再冻结。" >&2
      exit 1
    fi
  done
  log "  已确认资金池/注册中心已初始化，开始冻结（不可逆）..."
  solana program set-upgrade-authority "${TRADE_PROGRAM_ID}" --final --url "${SOLANA_RPC_URL}" 2>&1 | tee -a "${LOG_FILE}"
  solana program set-upgrade-authority "${SUPPLY_PROGRAM_ID}" --final --url "${SOLANA_RPC_URL}" 2>&1 | tee -a "${LOG_FILE}"
  log "  已冻结。合约将无法再升级。"
fi

# ---------- 8. 验证 ----------
log "==> [8/8] 验证部署"
SOLANA_RPC_URL="${SOLANA_RPC_URL}" \
  TRADE_FINANCE_PROGRAM_ID="${TRADE_PROGRAM_ID}" \
  USDC_MINT="${USDC_MINT}" LP_MINT="${LP_MINT}" \
  ADMIN_WALLET="${DEPLOY_WALLET}" REQUIRE_POOL=0 \
  bash "${ROOT}/scripts/verify-contract-deployment.sh" | tee -a "${LOG_FILE}"

echo "----------------------------------------"
echo "✅ 主网部署完成（日志：${LOG_FILE}）"
echo "trade_finance: ${TRADE_PROGRAM_ID}"
echo "supply_chain:  ${SUPPLY_PROGRAM_ID}"
echo ""
echo "⚠️ 后续步骤（涉及真实资金，未自动执行）："
echo "  1) 初始化资金池 + 真实存款：node scripts/init-localnet.mjs（换成主网 RPC/mint）"
echo "  2) 初始化供应链注册中心：node scripts/init-supply-chain.mjs <真实供应商公钥...>"
echo "  3) 配置服务环境变量（见 docs/MAINNET-MIGRATION.md 配置替换表）"
echo "  4) 小额真实资金冒烟：node scripts/smoke-e2e.mjs"
echo "  5) 保存 Program keypair 离线备份（未冻结升级权限前切勿丢失）"
