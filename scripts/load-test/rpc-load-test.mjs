#!/usr/bin/env node
// Solana RPC 轻量压测：并发请求真实 RPC，输出吞吐、延迟分位和错误率报告。
// 用法：
//   SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=xxx" node scripts/load-test/rpc-load-test.mjs
// Env:
//   HELIUS_API_KEY       提供时自动拼 mainnet/devnet Helius URL
//   NETWORK=mainnet|devnet（默认 mainnet，配合 HELIUS_API_KEY 使用）
//   CONCURRENCY=10       并发数
//   TOTAL_REQUESTS=200   总请求数
//   REPORT_PATH=/tmp/rpc-load-test.json

const {
  HELIUS_API_KEY,
  NETWORK = "mainnet",
  CONCURRENCY = 10,
  TOTAL_REQUESTS = 200,
  REPORT_PATH = "/tmp/rpc-load-test.json",
} = process.env;

const RPC =
  process.env.SOLANA_RPC_URL ??
  (HELIUS_API_KEY
    ? `https://${NETWORK}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
    : undefined);

if (!RPC) {
  console.error("set SOLANA_RPC_URL or HELIUS_API_KEY");
  process.exit(2);
}

const METHODS = [
  ["getHealth", []],
  ["getVersion", []],
  ["getSlot", []],
  ["getLatestBlockhash", [{ commitment: "confirmed" }]],
  ["getBalance", ["11111111111111111111111111111111"]],
];

const requests = Array.from({ length: Number(TOTAL_REQUESTS) }, (_, i) => {
  const [method, params] = METHODS[i % METHODS.length];
  return { method, params };
});

let nextId = 1;

async function callRpc({ method, params }) {
  const start = performance.now();
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json();
    const error = body?.error
      ? JSON.stringify(body.error).slice(0, 200)
      : undefined;
    return {
      ok: res.ok && body.error == null,
      latencyMs: performance.now() - start,
      status: res.status,
      method,
      error,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: performance.now() - start,
      status: 0,
      method,
      error: String(error).slice(0, 200),
    };
  }
}

async function run() {
  const startedAt = Date.now();
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Number(CONCURRENCY) }, async () => {
    while (cursor < requests.length) {
      const item = requests[cursor++];
      results.push(await callRpc(item));
    }
  });
  await Promise.all(workers);
  const elapsedMs = Date.now() - startedAt;

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const okCount = results.filter((r) => r.ok).length;
  const percentile = (p) => {
    if (latencies.length === 0) return 0;
    const idx = Math.min(
      latencies.length - 1,
      Math.ceil((p / 100) * latencies.length) - 1,
    );
    return Number(latencies[idx].toFixed(2));
  };

  const byMethod = {};
  for (const r of results) {
    byMethod[r.method] ??= { total: 0, ok: 0, errors: 0 };
    byMethod[r.method].total += 1;
    if (r.ok) byMethod[r.method].ok += 1;
    else byMethod[r.method].errors += 1;
  }

  const report = {
    rpc: RPC.replace(/api-key=.*/, "api-key=***"),
    startedAt: new Date(startedAt).toISOString(),
    durationMs: elapsedMs,
    totalRequests: results.length,
    concurrency: Number(CONCURRENCY),
    throughputRps: Number(((results.length / elapsedMs) * 1000).toFixed(2)),
    successRate: Number(((okCount / results.length) * 100).toFixed(2)),
    latencyMs: {
      min: Number((latencies[0] ?? 0).toFixed(2)),
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      max: Number((latencies[latencies.length - 1] ?? 0).toFixed(2)),
    },
    byMethod,
    sampleErrors: results
      .filter((r) => !r.ok)
      .slice(0, 5)
      .map((r) => ({ method: r.method, status: r.status, error: r.error })),
  };

  console.log(JSON.stringify(report, null, 2));
  if (REPORT_PATH) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`report written: ${REPORT_PATH}`);
  }
  if (report.successRate < 95) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
