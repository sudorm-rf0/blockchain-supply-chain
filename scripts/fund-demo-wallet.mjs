// 演示辅助：给指定钱包打 SOL 和 USDC（localnet）。
// 用法：USDC_MINT=<init-localnet 输出> node scripts/fund-demo-wallet.mjs <wallet>
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const USDC_MINT = process.env.USDC_MINT;
const SOL_AMOUNT = Number(process.env.SOL_AMOUNT ?? 5);
const USDC_AMOUNT = BigInt(process.env.USDC_AMOUNT ?? 10_000_000_000n); // 10,000 USDC

const walletAddress = process.argv[2];
if (!walletAddress) {
  console.error("usage: USDC_MINT=<mint> node scripts/fund-demo-wallet.mjs <wallet>");
  process.exit(1);
}
if (!USDC_MINT) {
  console.error("USDC_MINT is required (see init-localnet output)");
  process.exit(1);
}

const conn = new Connection(RPC, "confirmed");
const keypairPath =
  process.env.SOLANA_KEYPAIR_PATH ??
  `${homedir()}/.config/solana/id.json`;
const adminSecret = JSON.parse(readFileSync(keypairPath, "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));
const wallet = new PublicKey(walletAddress);

await conn.requestAirdrop(wallet, SOL_AMOUNT * 1_000_000_000);
await new Promise((resolve) => setTimeout(resolve, 800));
const ata = await getOrCreateAssociatedTokenAccount(conn, admin, new PublicKey(USDC_MINT), wallet);
await mintTo(conn, admin, new PublicKey(USDC_MINT), ata.address, admin.publicKey, USDC_AMOUNT);

console.log(`funded ${wallet.toBase58()}: ${SOL_AMOUNT} SOL + ${USDC_AMOUNT / 1_000_000n} USDC`);
