#!/usr/bin/env node
/**
 * JSON-RPC 方法白名单网关（零依赖，Node 内置模块）
 * 隔离 Hardhat 私链(8545)，只放行只读安全方法，拒绝 hardhat_ 等危险方法。
 * 监听 0.0.0.0:8546（ufw 仅放行 Docker 网段），转发到 127.0.0.1:8545。
 * 被拒请求由本网关直接返回错误（不接触上游），批量请求保持原顺序。
 */
const http = require("http");

const UPSTREAM = { host: "127.0.0.1", port: 8545 };
const LISTEN_PORT = 8546;

// 只读安全方法白名单（fail-closed：不在白名单内一律拒绝）
const SAFE_METHODS = new Set([
  "web3_clientVersion", "web3_sha3",
  "net_version", "net_listening", "net_peerCount",
  "eth_protocolVersion", "eth_syncing", "eth_chainId",
  "eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_getStorageAt",
  "eth_call", "eth_estimateGas",
  "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs",
]);

const BLOCKED_PREFIX = /^(hardhat|evm|personal|debug|trace|anvil|miner|admin|txpool)/;
const BLOCKED_EXACT = /^(eth_sendTransaction|eth_sendRawTransaction|eth_sign|eth_signTypedData|eth_accounts|eth_coinbase|eth_newFilter|eth_newBlockFilter|eth_newPendingTransactionFilter|eth_uninstallFilter|eth_getFilterLogs|eth_getFilterChanges|eth_subscribe|eth_unsubscribe|eth_compile)/;

function methodAllowed(method) {
  if (typeof method !== "string" || method === "") return false;
  if (SAFE_METHODS.has(method)) return true;
  if (BLOCKED_PREFIX.test(method) || BLOCKED_EXACT.test(method)) return false;
  return false; // 未知方法默认拒绝（fail closed）
}

function errObj(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// 返回 { forwards: [被转发请求], locals: Map<序号, 错误对象> }
function classify(body) {
  if (Array.isArray(body)) {
    const forwards = [];
    const locals = new Map();
    body.forEach((r, i) => {
      if (r && typeof r === "object" && typeof r.method === "string") {
        if (methodAllowed(r.method)) forwards.push(r);
        else locals.set(i, errObj(r.id, -32601, "Method not allowed: " + r.method));
      } else {
        locals.set(i, errObj(null, -32600, "Invalid Request"));
      }
    });
    return { forwards, locals };
  }
  if (body && typeof body === "object" && typeof body.method === "string") {
    if (methodAllowed(body.method)) return { forwards: [body], locals: null };
    const m = new Map();
    m.set(0, errObj(body.id, -32601, "Method not allowed: " + body.method));
    return { forwards: [], locals: m };
  }
  const m = new Map();
  m.set(0, errObj(null, -32600, "Invalid Request"));
  return { forwards: [], locals: m };
}

function respond(res, code, data) {
  res.writeHead(code);
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") { respond(res, 405, errObj(null, -32600, "POST only")); return; }
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 1024 * 1024) req.destroy(); });
  req.on("end", () => {
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { respond(res, 400, errObj(null, -32700, "Parse error")); return; }
    const isBatch = Array.isArray(body);
    const { forwards, locals } = classify(body);

    if (forwards.length === 0) {
      // 全部被拒：直接返回，不触碰上游
      const arr = isBatch ? body.map((_, i) => locals.get(i)) : locals.get(0);
      respond(res, 200, arr);
      return;
    }
    const payload = JSON.stringify(isBatch ? forwards : forwards[0]);
    const upstream = http.request({ ...UPSTREAM, method: "POST", path: "/", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (up) => {
      let out = "";
      up.on("data", (c) => { out += c; });
      up.on("end", () => {
        if (!isBatch) { respond(res, up.statusCode ?? 200, out || JSON.stringify(errObj(null, -32603, "Upstream empty"))); return; }
        let upRes;
        try { upRes = JSON.parse(out || "[]"); } catch { respond(res, 502, out); return; }
        const upArr = Array.isArray(upRes) ? upRes : [upRes];
        const merged = body.map((_, i) => (locals.has(i) ? locals.get(i) : upArr.shift() ?? errObj(null, -32603, "No response")));
        respond(res, 200, merged);
      });
    });
    upstream.on("error", (e) => { respond(res, 502, errObj(null, -32603, "Upstream error: " + e.message)); });
    upstream.write(payload);
    upstream.end();
  });
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log("rpc-gateway listening on :" + LISTEN_PORT + " -> " + UPSTREAM.host + ":" + UPSTREAM.port);
});
