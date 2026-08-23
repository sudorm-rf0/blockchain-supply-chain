# 私链 JSON-RPC 方法白名单网关

## 背景
USD⇄USDT escrow 私链（Hardhat 节点）原以 root 运行、监听 `0.0.0.0:8545`、
无任何鉴权（`hardhat_setBalance`/`hardhat_impersonateAccount`/解锁账户转账均可调用）。

## 加固内容（2026-08-24）
1. Hardhat 节点（`usdt-chain.service`）：
   - 绑定 `127.0.0.1:8545`（脱离 Docker 网段与公网）
   - 以非 root 用户 `usdt-chain` 运行（`NoNewPrivileges=true`）
   - unit 文件 `chmod 600`
2. 新增 RPC 网关（`rpc-gateway.service` + 本目录 `rpc-gateway.js`）：
   - 监听 `0.0.0.0:8546`（ufw 仅放行 `172.16.0.0/12` Docker 网段）
   - **fail-closed 方法白名单**：仅放行只读方法（eth_call/getBalance/getLogs/estimateGas 等），
     拒绝 `hardhat_*`/`evm_*`/`personal_*`/`eth_sendTransaction`/`eth_sign`/`eth_accounts` 等
   - 被拒请求由网关直接返回错误，不接触上游；批量请求保持原顺序
3. nginx `/rpc` 反代从 `172.17.0.1:8545` 改为 `172.17.0.1:8546`（走网关）

## 部署/重建
```bash
sudo cp deploy/vps/rpc-gateway.js /opt/usd-usdt-escrow/rpc-gateway.js
sudo chown usdt-chain:usdt-chain /opt/usd-usdt-escrow/rpc-gateway.js
# systemd unit：User=usdt-chain，ExecStart=/usr/bin/node /opt/usd-usdt-escrow/rpc-gateway.js
sudo systemctl daemon-reload && sudo systemctl restart rpc-gateway
```

## 验证
```bash
# 允许
curl -s -X POST http://127.0.0.1:8546/ -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"net_version","params":[]}'
# 拒绝（应返回 -32601 Method not allowed）
curl -s -X POST http://127.0.0.1:8546/ -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"eth_accounts","params":[]}'
```
