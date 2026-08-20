#!/usr/bin/env bash
# 链上安全巡检（纯 bash+curl，无 node 依赖，适合 VPS cron）
# 用法: bash scripts/onchain-security-audit.sh
# 失败时退出码非 0；配合 cron + 告警邮件。
set -u
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
TRADE="8GSbCjUhgpvgQ35tx7wqFZCznP5HW2mn1jUYcGahC4tq"
SUPPLY="BGSBnaAs2uhsYhUA2KJBmirMcK551JLm9thy7P2y2cDh"
TRADE_PD="Ebi9gd1pkfaP9Z1Z3NvU7GjoFs1Ce2VysF83Cp9ZgftK"
SUPPLY_PD="GpYHmTfM2Lyk9DYySLvCcykZ9rfFUxeZA5PCPWX1Jn6"
POOL="BGuPKjqfC8tsBPmHUKkS2KVDMBGvbk21QH1R976KQm2r"
VAULT_ATA="J7t5Qh59nNzSDWn1ATRiv2mUHnhD4ao9ZKkStueqoPhF"
LP="4fJthZiYPZ9uAqr38Uj2p2DJbPWjxUDP94Vo3RcwaWtw"
EXPECTED_UA_HEX="0b2a5ad0e43ba06e3f1e4d28d4e1d3c0f9a08b6c2e5f8a1b3c4d5e6f7a8b9c0d1" # 占位（由下方生成）
EXPECTED_UA="FAB17dFi22Gzq7tZ7rfDmKzAejmTeKuk7FM6S2LfREN1"

# 从 UA 公钥算 hex（用 python3 base58 解码）
UA_HEX=$(python3 - <<PYEOF
import base64, sys
# 简单 base58 解码（仅用于 32 字节公钥）
ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
s = "$EXPECTED_UA"
n = 0
for ch in s:
    n = n * 58 + ALPHA.index(ch)
b = n.to_bytes(32, "big")
print(b.hex())
PYEOF
)

fail=0
chk() { # name pass detail
  if [ "$2" = "0" ]; then echo "❌ $1 — $3"; fail=1; else echo "✅ $1 — $3"; fi
}

rpc() { # method params
  curl -sS --max-time 15 -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "${RPC}"
}

# 1) 程序可执行
for pair in "trade_finance:$TRADE" "supply_chain:$SUPPLY"; do
  name="${pair%%:*}"; addr="${pair##*:}"
  exec_ok=$(rpc getAccountInfo "[\"$addr\",{\"encoding\":\"jsonParsed\"}]" | python3 -c "import sys,json;d=json.load(sys.stdin);r=d.get('result',{}).get('value');print(1 if r and r.get('executable') else 0)")
  chk "程序 $name 可执行" "$exec_ok" "$addr"
done

# 2) upgrade authority（ProgramData data[12]==1 且 data[13:45]==UA hex）
for pair in "trade_finance:$TRADE_PD" "supply_chain:$SUPPLY_PD"; do
  name="${pair%%:*}"; pd="${pair##*:}"
  ua=$(rpc getAccountInfo "[\"$pd\",{\"encoding\":\"base64\"}]" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
r=d.get('result',{}).get('value')
if not r: print('NO_DATA'); sys.exit()
data=base64.b64decode(r['data'][0])
ua=data[13:45].hex()
print(ua)
")
  if [ "$ua" = "$UA_HEX" ]; then chk "程序 $name UA 匹配" 1 ""; else chk "程序 $name UA 匹配" 0 "UA=$ua"; fi
done

# 3) 池 paused（新版 485 布局 offset 120, u8）
paused=$(rpc getAccountInfo "[\"$POOL\",{\"encoding\":\"base64\"}]" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
r=d.get('result',{}).get('value')
if not r: print('NO_POOL'); sys.exit()
data=base64.b64decode(r['data'][0])
print(data[120])
")
if [ "$paused" = "0" ]; then chk "池未暂停" 1 ""; else chk "池未暂停" 0 "paused=$paused"; fi

# 4) 池 USDC 托管余额
bal=$(rpc getTokenAccountBalance "[\"$VAULT_ATA\"]" | python3 -c "import sys,json;d=json.load(sys.stdin);r=d.get('result',{}).get('value');print(r['uiAmount'] if r else '0')")
bal_ok=$(python3 -c "print(1 if float('$bal') > 0 else 0)")
chk "池 USDC 托管余额 > 0" "$bal_ok" "$bal TEST_USDC"

# 5) LP supply
lp=$(rpc getTokenSupply "[\"$LP\"]" | python3 -c "import sys,json;d=json.load(sys.stdin);r=d.get('result',{}).get('value');print(r['uiAmount'] if r else '0')")
chk "LP supply 可读" "$(python3 -c "print(1 if float('$lp') > 0 else 0)")" "$lp LP"

echo ""
if [ "$fail" = "1" ]; then echo "❌ 链上安全巡检失败"; exit 1; else echo "✅ 链上安全巡检全部通过"; exit 0; fi
