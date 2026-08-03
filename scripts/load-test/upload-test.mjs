import { Keypair } from "@solana/web3.js";
import { deflateSync } from "node:zlib";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const TOTAL = Number(process.env.TOTAL ?? 30);
const EMAIL = `upload-load-${Date.now()}@example.com`;

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// 每次生成不同像素的 1x1 RGBA PNG，避免触发重复哈希校验。
function makePng(seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([
    0,
    seed % 256,
    (seed >> 8) % 256,
    (seed >> 16) % 256,
    255,
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

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
  const png = makePng(index + 1);
  fd.append("file", new Blob([png], { type: "image/png" }), `load-${index}.png`);
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
