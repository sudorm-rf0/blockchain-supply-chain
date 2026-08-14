import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { basename } from "node:path";

const BASE = "http://127.0.0.1:3001";
const RPC = "http://localhost:8899";
const EXTRACT = "/tmp/purechain-VtyyFy/20250821农行付汇544007.12美元-龙果园";
const FILE_A = `${EXTRACT}/20250821农行付汇544007.12美元-报关单.pdf`;
const FILE_B = `${EXTRACT}/CXRU1003397发票.pdf`;
const ZIP_FILE = `${EXTRACT}/2025-8-21 544007.12美金东曼DRAGON ORCHARD农行(1).zip`;
const ROOT = "/Users/fangfang/Documents/区块链供应链";
const results = {};

const conn = new Connection(RPC, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
const wallet = Keypair.generate();
const O = { Origin: "http://localhost:3001" };

function redisPw() { return readFileSync(`${ROOT}/.env`, "utf8").split("REDIS_PASSWORD=")[1].split(/\r?\n/)[0]; }
function redisFlush() { execSync(`docker exec supply-chain-redis redis-cli -a '${redisPw()}' FLUSHDB`, {stdio:"ignore"}); }
function redisCode(email) {
  const d = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  try { const out = execSync(`docker exec supply-chain-redis redis-cli -a '${redisPw()}' GET 'email-code:code:${d}'`, {encoding:"utf8"}).trim(); return JSON.parse(out).code; } catch { return null; }
}

async function api(path, { method="GET", token, body, headers={}, rawBody, ctype } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (rawBody) { payload = rawBody; if (ctype) h["content-type"] = ctype; }
  else if (body !== undefined) { payload = JSON.stringify(body); h["content-type"] = "application/json"; }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { code: res.status, headers: Object.fromEntries(res.headers), j };
}

async function fund(pubkey, sol=2) {
  const tx = new Transaction();
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: pubkey, lamports: BigInt(Math.round(sol*1e9)) }));
  tx.sign(admin);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function signSend(txB64, signer) {
  const tx = Transaction.from(Buffer.from(txB64, "base64"));
  tx.sign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function upload(path, desc) {
  const content = readFileSync(path);
  const boundary = "----chain";
  const parts = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${basename(path)}"\r\nContent-Type: application/pdf\r\n\r\n`));
  parts.push(content);
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${desc}\r\n--${boundary}--\r\n`));
  return api("/api/files", { method: "POST", token: userToken, headers: O, rawBody: Buffer.concat(parts), ctype: `multipart/form-data; boundary=${boundary}` });
}

// 1) 注册 + 绑定临时钱包
redisFlush();
const email = `chain-${Date.now()}@t.local`;
let r = await api("/api/auth/register", { method:"POST", body:{ name:"链路测试", email, password:"Passw0rd!x", wallet: wallet.publicKey.toBase58() }, headers: O });
results.register = [r.code, !!r.j?.requiresEmailVerification];
const code1 = redisCode(email);
r = await api("/api/auth/verify-email", { method:"POST", body:{ email, code: code1 }, headers: O });
results.verifyEmail = r.code;
redisFlush();
await api("/api/auth/login", { method:"POST", body:{ email, password:"Passw0rd!x" }, headers: O });
const code2 = redisCode(email);
r = await api("/api/auth/login", { method:"POST", body:{ email, password:"Passw0rd!x", emailOtpCode: code2 }, headers: O });
const userToken = r.j?.accessToken;
results.login = [r.code, !!userToken];

// 2) 打 SOL
await fund(wallet.publicKey, 2);
results.fundSol = (await conn.getBalance(wallet.publicKey)) / 1e9;

// 3) 上传
r = await upload(FILE_A, "农行付汇 544007.12 美元-报关单（纯链路测试）");
const fidA = r.j?.id;
results.uploadA = [r.code, !!fidA, r.j?.hash?.slice(0,16)+"...", r.j?.status, r.j?.size];
r = await upload(FILE_B, "龙果园发票（纯链路测试）");
const fidB = r.j?.id;
results.uploadB = [r.code, !!fidB, r.j?.hash?.slice(0,16)+"...", r.j?.status, r.j?.size];
r = await upload(ZIP_FILE, "内嵌 zip（应被扩展名白名单拒绝）");
results.uploadZip = [r.code, r.j?.message];

// 4) 存证上链
async function attest(fid) {
  let r = await api(`/api/files/${fid}/attest`, { method:"POST", body:{ walletAddress: wallet.publicKey.toBase58() }, token: userToken, headers: O });
  if (r.code !== 200 || !r.j?.transaction) return [r.code, r.j?.message];
  const sig = await signSend(r.j.transaction, wallet);
  const r2 = await api(`/api/files/${fid}/attest/confirm`, { method:"POST", body:{ txSignature: String(sig), documentPda: r.j.documentPda }, token: userToken, headers: O });
  return [r2.code, !!r2.j?.txSignature, r2.j?.txSignature?.slice(0,14)+"...", r2.j?.documentPda?.slice(0,14)+"...", r2.j?.attestedAt ? true : false];
}
results.attestA = await attest(fidA);
results.attestB = await attest(fidB);

// 5) 管理员审核
let at = null;
r = await api("/api/auth/login", { method:"POST", body:{ email:"admin@supply-chain.io", password:"Admin123!" }, headers: O });
if (r.code === 200 && r.j?.accessToken) at = r.j.accessToken;
results.adminLogin = !!at;
if (at) {
  r = await api(`/api/files/${fidA}`, { method:"PATCH", body:{ status:"APPROVED", confirm:true, remark:"纯链路测试-通过" }, token: at, headers: O });
  results.reviewA = [r.code, r.j?.status];
  r = await api(`/api/files/${fidB}`, { method:"PATCH", body:{ status:"APPROVED", confirm:true, remark:"纯链路测试-通过" }, token: at, headers: O });
  results.reviewB = [r.code, r.j?.status];
}

// 6) 读取
r = await api(`/api/files/${fidA}/content`, { token: userToken });
results.readA = [r.code, "CT="+r.headers["content-type"], "CSP="+r.headers["content-security-policy"]];
r = await api("/api/files", { token: userToken });
results.listFiles = (r.j?.items ?? []).map(it => [it.filename, it.status]);

// 7) 审计日志
if (at) {
  r = await api("/api/admin/audit-logs?limit=80", { token: at });
  const acts = (r.j?.items ?? []).map(x => x.action);
  for (const w of ["AUTH_REGISTER","FILE_UPLOADED","FILE_APPROVED","FILE_ATTESTED"]) results[`audit_${w}`] = acts.includes(w);
  results.auditSample = acts.filter(a => ["FILE_UPLOADED","FILE_APPROVED","FILE_ATTESTED"].includes(a)).slice(0,6);
}

console.log(JSON.stringify(results, null, 1));
require("node:fs").writeFileSync("/tmp/chain_ids.json", JSON.stringify({ fidA, fidB, email, userToken, adminToken: at }));
