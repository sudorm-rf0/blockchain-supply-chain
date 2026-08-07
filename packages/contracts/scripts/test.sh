#!/usr/bin/env bash
# 测试入口（CI 与本地共用）。
#
# anchor test -- --features test-deployer 通过 solana-test-validator --bpf-program 预加载程序，
# 程序 upgrade authority 为 None，initialize_pool/initialize_registry 走
# DEPLOYER 白名单。为让任意环境（本机/CI）都能初始化，本脚本在测试前
# 把两个程序的 DEPLOYER 常量动态替换为当前部署钱包（provider.wallet）地址，
# 测试结束后恢复源码。
set -euo pipefail

SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/active_release/bin}"
CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"
if [ -d "$SOLANA_BIN" ] || [ -d "$CARGO_BIN" ]; then
  export PATH="$CARGO_BIN:$SOLANA_BIN:$PATH"
fi

# macOS bsdtar writes AppleDouble (._*) entries into genesis.tar.bz2, which
# the validator's ledger unpack check rejects with a "blockstore error".
export COPYFILE_DISABLE=1

cd "$(dirname "$0")/.."

bash scripts/clean-test-ledger.sh
mkdir -p "$HOME/.config/solana"
if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
  solana-keygen new --force --no-bip39-passphrase -o "$HOME/.config/solana/id.json" >/dev/null
fi

DEPLOYER_PUBKEY="$(solana-keygen pubkey "$HOME/.config/solana/id.json")"
echo "test: injecting DEPLOYER=$DEPLOYER_PUBKEY"

FILES=("programs/trade-finance/src/lib.rs" "programs/supply-chain/src/lib.rs")
BACKUPS=()
restore() {
  for i in "${!FILES[@]}"; do
    if [ -f "${FILES[$i]}.bak" ]; then
      mv "${FILES[$i]}.bak" "${FILES[$i]}"
    fi
  done
}
trap restore EXIT

for f in "${FILES[@]}"; do
  cp "$f" "$f.bak"
  # 替换 DEPLOYER 常量中的公钥（保持 pubkey!("...") 结构）
  sed -i.bak2 "s/pubkey!(\"[A-Za-z0-9]*\")/pubkey!(\"${DEPLOYER_PUBKEY}\")/" "$f"
  rm -f "$f.bak2"
done

anchor test -- --features test-deployer
