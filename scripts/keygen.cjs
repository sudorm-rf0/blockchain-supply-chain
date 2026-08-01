#!/usr/bin/env node
"use strict";

const { Keypair } = require("@solana/web3.js");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const DEFAULT_TARGET =
  "packages/contracts/target/deploy/supply_chain-keypair.json";
const args = process.argv.slice(2);
const readOnly = args.includes("--read");
const targetArg = args.filter((arg) => arg !== "--read").pop();
const target = resolve(process.cwd(), targetArg || DEFAULT_TARGET);

function readPubkey() {
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(target, "utf8")));
  return Keypair.fromSecretKey(secretKey).publicKey.toBase58();
}

if (readOnly) {
  if (!existsSync(target)) {
    process.stderr.write(`keypair not found: ${target}\n`);
    process.exit(1);
  }
  process.stdout.write(`${readPubkey()}\n`);
} else {
  const keypair = Keypair.generate();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify([...keypair.secretKey]));
  process.stdout.write(`${keypair.publicKey.toBase58()}\n`);
}
