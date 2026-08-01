"use client";

import {
  BaseMessageSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletError,
  WalletName,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  scopePollingDetectionStrategy,
} from "@solana/wallet-adapter-base";
import { PublicKey, type Transaction } from "@solana/web3.js";

interface UnsolvedBloomProvider {
  publicKey?: string;
  connect?: () =>
    | Promise<{ publicKey?: string } | void>
    | { publicKey?: string }
    | void;
  disconnect?: () => Promise<void> | void;
  signTransaction?: (
    transaction: Transaction,
  ) => Promise<Transaction> | Transaction;
  signAllTransactions?: (
    transactions: Transaction[],
  ) => Promise<Transaction[]> | Transaction[];
  signMessage?: (message: Uint8Array) => Promise<Uint8Array> | Uint8Array;
}

interface UnsolvedBloomWindow extends Window {
  unsolvedBloom?: UnsolvedBloomProvider;
  unsolvedbloom?: UnsolvedBloomProvider;
}

function getProvider(): UnsolvedBloomProvider | null {
  if (typeof window === "undefined") return null;
  const win = window as UnsolvedBloomWindow;
  return win.unsolvedBloom ?? win.unsolvedbloom ?? null;
}

const ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6d28d9"/><circle cx="16" cy="16" r="9" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M11 22 16 10l5 12-5-3z" fill="#ffffff"/></svg>`,
)}`;

export class UnsolvedBloomWalletAdapter extends BaseMessageSignerWalletAdapter<"Unsolved Bloom"> {
  readonly name: WalletName<"Unsolved Bloom"> =
    "Unsolved Bloom" as WalletName<"Unsolved Bloom">;
  readonly url = "https://unsolved.xyz/";
  readonly icon = ICON;
  readonly supportedTransactionVersions = undefined;

  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  constructor() {
    super();
    if (typeof window !== "undefined") {
      scopePollingDetectionStrategy(() => {
        if (getProvider()) {
          this.emit("readyStateChange", WalletReadyState.Installed);
          return true;
        }
        return false;
      });
    }
  }

  get readyState(): WalletReadyState {
    return getProvider()
      ? WalletReadyState.Installed
      : WalletReadyState.NotDetected;
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  async connect(): Promise<void> {
    try {
      const provider = getProvider();
      if (!provider) {
        throw new WalletConnectionError(
          "Unsolved Bloom 钱包扩展未安装",
          new WalletNotReadyError(),
        );
      }
      this._connecting = true;
      const result = await provider.connect?.();
      const rawPublicKey =
        provider.publicKey ??
        (result && "publicKey" in result ? result.publicKey : undefined);
      if (!rawPublicKey) {
        throw new WalletConnectionError(
          "Unsolved Bloom 未返回钱包公钥",
        );
      }
      this._publicKey = new PublicKey(rawPublicKey);
      this.emit("connect", this._publicKey);
    } catch (error) {
      const wrapped =
        error instanceof WalletError
          ? error
          : new WalletConnectionError("连接 Unsolved Bloom 失败", error);
      this.emit("error", wrapped);
      throw wrapped;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      const provider = getProvider();
      await provider?.disconnect?.();
    } catch (error) {
      const wrapped =
        error instanceof WalletError
          ? error
          : new WalletDisconnectionError("断开 Unsolved Bloom 失败", error);
      this.emit("error", wrapped);
      throw wrapped;
    } finally {
      this._publicKey = null;
      this.emit("disconnect");
    }
  }

  async signTransaction<T extends Transaction>(transaction: T): Promise<T> {
    const provider = getProvider();
    if (!provider || !this._publicKey) {
      throw new WalletNotConnectedError();
    }
    if (!provider.signTransaction) {
      throw new WalletSignTransactionError(
        "Unsolved Bloom 不支持直接签名交易",
      );
    }
    try {
      const signed = await provider.signTransaction(transaction);
      return signed as T;
    } catch (error) {
      const wrapped =
        error instanceof WalletError
          ? error
          : new WalletSignTransactionError("签名交易失败", error);
      this.emit("error", wrapped);
      throw wrapped;
    }
  }

  async signAllTransactions<T extends Transaction>(
    transactions: T[],
  ): Promise<T[]> {
    const provider = getProvider();
    if (!provider || !this._publicKey) {
      throw new WalletNotConnectedError();
    }
    if (!provider.signAllTransactions) {
      throw new WalletSignTransactionError(
        "Unsolved Bloom 不支持批量签名交易",
      );
    }
    try {
      const signed = await provider.signAllTransactions(transactions);
      return signed as T[];
    } catch (error) {
      const wrapped =
        error instanceof WalletError
          ? error
          : new WalletSignTransactionError("批量签名交易失败", error);
      this.emit("error", wrapped);
      throw wrapped;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const provider = getProvider();
    if (!provider || !this._publicKey) {
      throw new WalletNotConnectedError();
    }
    if (!provider.signMessage) {
      throw new WalletSignMessageError(
        "Unsolved Bloom 不支持消息签名",
      );
    }
    try {
      return await provider.signMessage(message);
    } catch (error) {
      const wrapped =
        error instanceof WalletError
          ? error
          : new WalletSignMessageError("消息签名失败", error);
      this.emit("error", wrapped);
      throw wrapped;
    }
  }
}
