import { PublicKey } from "@solana/web3.js";
import { DealSyncPayload } from "./payloads";

export const TRADE_DEAL_ACCOUNT_SIZE = 129;

const DISCRIMINATOR_SIZE = 8;
const PUBKEY_SIZE = 32;
const U64_SIZE = 8;

const OFFSET_ID = DISCRIMINATOR_SIZE;
const OFFSET_BUYER = OFFSET_ID + U64_SIZE;
const OFFSET_SELLER = OFFSET_BUYER + PUBKEY_SIZE;
const OFFSET_AMOUNT = OFFSET_SELLER + PUBKEY_SIZE;
const OFFSET_DOWN_PAYMENT = OFFSET_AMOUNT + U64_SIZE;
const OFFSET_POOL_PORTION = OFFSET_DOWN_PAYMENT + U64_SIZE;
const OFFSET_TENOR = OFFSET_POOL_PORTION + U64_SIZE;
const OFFSET_STATUS = OFFSET_TENOR + U64_SIZE;
const OFFSET_CREATED_AT = OFFSET_STATUS + 1;
const OFFSET_REPAID_AT = OFFSET_CREATED_AT + U64_SIZE;

export const DEAL_STATUS_BY_CODE: Record<number, string> = {
  0: "PENDING",
  1: "FUNDED",
  2: "IN_TRANSIT",
  3: "CUSTOMS_CLEAR",
  4: "DELIVERED",
  5: "REPAYING",
  6: "SETTLED",
  7: "DEFAULTED",
};

export function parseTradeDealBuffer(
  data: Buffer,
  accountKey: string,
): DealSyncPayload {
  if (data.length < TRADE_DEAL_ACCOUNT_SIZE) {
    throw new Error(`invalid TradeDeal buffer length: ${data.length}`);
  }

  const id = data.readBigUInt64LE(OFFSET_ID);
  const buyer = new PublicKey(
    data.subarray(OFFSET_BUYER, OFFSET_BUYER + PUBKEY_SIZE),
  ).toBase58();
  const seller = new PublicKey(
    data.subarray(OFFSET_SELLER, OFFSET_SELLER + PUBKEY_SIZE),
  ).toBase58();
  const amount = data.readBigUInt64LE(OFFSET_AMOUNT);
  const downPayment = data.readBigUInt64LE(OFFSET_DOWN_PAYMENT);
  const poolPortion = data.readBigUInt64LE(OFFSET_POOL_PORTION);
  const tenor = data.readBigInt64LE(OFFSET_TENOR);
  const status = data.readUInt8(OFFSET_STATUS);
  const createdAt = data.readBigInt64LE(OFFSET_CREATED_AT);
  const repaidAt = data.readBigInt64LE(OFFSET_REPAID_AT);

  if (DEAL_STATUS_BY_CODE[status] === undefined) {
    throw new Error(`unknown TradeDeal status code: ${status}`);
  }

  return {
    accountKey,
    tradeId: id.toString(10),
    buyerWallet: buyer,
    sellerWallet: seller,
    amount: amount.toString(10),
    downPayment: downPayment.toString(10),
    poolPortion: poolPortion.toString(10),
    tenor: tenor.toString(10),
    status,
    createdAt: createdAt.toString(10),
    repaidAt: repaidAt.toString(10),
    txSignature: null,
    logisticsHash: null,
  };
}
