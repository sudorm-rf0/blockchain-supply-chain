import { Keypair } from "@solana/web3.js";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const TOTAL = Number(process.env.TOTAL ?? 30);
const EMAIL = `upload-load-${Date.now()}@example.com`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function register() {
  const wallet = Keypair.generate().publicKey.toBase58();
  const res = await fetch(`${BACKEND}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Load Tester",
      email: EMAIL,
      password: "secret123",
      wallet,
    }),
  });
  if (!res.ok) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).accessToken;
}

async function uploadOne(token, index) {
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), `load-${index}.png`);
  const start = performance.now();
  const res = await fetch(`${BACKEND}/api/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  });
  const ms = performance.now() - start;
  return { status: res.status, ms };
}

const token = await register();
const results = [];
let cursor = 0;

async function worker() {
  while (cursor < TOTAL) {
    const index = cursor++;
    try {
      results.push(await uploadOne(token, index));
    } catch (error) {
      results.push({ status: 0, ms: -1, error: String(error) });
    }
  }
}

const start = performance.now();
await Promise.all(
  Array.from({ length: CONCURRENCY }, () => worker()),
);
const elapsed = performance.now() - start;

const ok = results.filter((r) => r.status === 201 || r.status === 200);
const failed = results.filter((r) => r.status !== 201 && r.status !== 200);
const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
const avg = ms.reduce((a, b) => a + b, 0) / (ms.length || 1);
const p99 = ms[Math.floor(ms.length * 0.99)] ?? 0;

console.log(
  JSON.stringify(
    {
      uploads: TOTAL,
      concurrency: CONCURRENCY,
      elapsedMs: Math.round(elapsed),
      success: ok.length,
      failed: failed.length,
      failedSamples: failed.slice(0, 5),
      latency: { avgMs: Math.round(avg), p99Ms: Math.round(p99) },
      throughputPerSec: Math.round((ok.length / elapsed) * 1000),
    },
    null,
    2,
  ),
);
