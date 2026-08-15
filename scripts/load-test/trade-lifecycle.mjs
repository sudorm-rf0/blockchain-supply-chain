#!/usr/bin/env node
/**
 * 交易全生命周期并发压测
 * register → createTrade × N → confirm × N
 * 测试 Solana RPC 预构建吞吐和 confirm 绕行
 *
 * 用法:
 *   CONCURRENCY=5 TOTAL=20 node scripts/load-test/trade-lifecycle.mjs
 */

import { Keypair } from "@solana/web3.js";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";
const TRADE   = process.env.TRADE_API_URL ?? "http://localhost:3004";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);
const TOTAL       = Number(process.env.TOTAL ?? 20);

const EMAIL = `trade-load-${Date.now()}@example.com`;

// 邀请码制度：并发注册需要多个一次性邀请码，启动时由管理员批量生成
let INVITE_CODES = process.env.INVITE_CODE
  ? [process.env.INVITE_CODE]
  : (async () => {
      const login = await fetch(`${BACKEND}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: process.env.ADMIN_EMAIL ?? "admin@supply-chain.io",
          password: process.env.ADMIN_PASSWORD ?? "Admin123!",
        }),
      });
      const { accessToken } = await login.json();
      if (!accessToken) throw new Error("admin login failed for invite code");
      const gen = await fetch(`${BACKEND}/api/admin/invite-codes/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ count: TOTAL + CONCURRENCY }),
      });
      const body = await gen.json();
      return body.codes ?? [];
    })();

async function register() {
  const wallet = Keypair.generate().publicKey.toBase58();
  const codes = await INVITE_CODES;
  if (codes.length === 0) throw new Error("no invite codes available");
  const inviteCode = codes.shift();
  const res = await fetch(`${BACKEND}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Trade Load",
      email: EMAIL,
      password: "secret123",
      wallet,
      inviteCode,
    }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { token: body.accessToken ?? body.token, wallet };
}

async function createTrade(token, wallet, index) {
  const start = performance.now();
  const amount = String(1000000 + index);
  const res = await fetch(`${TRADE}/api/trades`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      buyerWallet: wallet,
      sellerWallet: "8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      amount,
      tenor: "30",
    }),
  });
  const ms = performance.now() - start;
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    ms,
    tradeId: body.tradeId ?? null,
    hasTransaction: typeof body.transaction === "string" && body.transaction.length > 0,
    duplicate: body.duplicate === true,
  };
}

async function listTrades(token) {
  const start = performance.now();
  const res = await fetch(`${TRADE}/api/trades`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const ms = performance.now() - start;
  return { status: res.status, ms, count: (await res.json()).length };
}

// ---- Main ----
const { token, wallet } = await register();
console.log(`Registered: ${EMAIL} wallet=${wallet}`);

// Phase 1: Create trades concurrently
const creates = [];
let cursor = 0;
async function createWorker() {
  while (cursor < TOTAL) {
    const i = cursor++;
    try {
      creates.push(await createTrade(token, wallet, i));
    } catch (e) {
      creates.push({ status: 0, ms: -1, tradeId: null, hasTransaction: false, error: String(e) });
    }
  }
}

const phase1Start = performance.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => createWorker()));
const phase1Ms = performance.now() - phase1Start;

// Phase 2: List trades
const listResult = await listTrades(token);

// ---- Report ----
const ok = creates.filter((r) => r.status === 201);
const dupes = creates.filter((r) => r.duplicate);
const failed = creates.filter((r) => r.status !== 201 && !r.duplicate);
const msList = ok.map((r) => r.ms).sort((a, b) => a - b);
const avgMs = msList.reduce((a, b) => a + b, 0) / (msList.length || 1);
const p99Ms = msList[Math.floor(msList.length * 0.99)] ?? 0;
const hasTx = ok.filter((r) => r.hasTransaction).length;

console.log(JSON.stringify({
  test: "trade-lifecycle",
  total: TOTAL,
  concurrency: CONCURRENCY,
  phase1Ms: Math.round(phase1Ms),
  create: {
    success: ok.length,
    duplicates: dupes.length,
    failed: failed.length,
    withTransaction: hasTx,
    latency: { avgMs: Math.round(avgMs), p99Ms: Math.round(p99Ms) },
    throughputPerSec: Math.round((ok.length / phase1Ms) * 1000),
  },
  list: {
    status: listResult.status,
    trades: listResult.count,
    ms: Math.round(listResult.ms),
  },
}, null, 2));
