import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { INDEXER_ENV } from "../config/env";
import {
  POOL_STATE_ACCOUNT_SIZE,
  parsePoolStateBuffer,
} from "./pool-state.parser";
import {
  TRADE_DEAL_ACCOUNT_SIZE,
  parseTradeDealBuffer,
} from "./trade-deal.parser";
import { SyncQueueService } from "./sync-queue.service";

interface KeyedAccountInfo {
  accountId: PublicKey;
  accountInfo: AccountInfo<Buffer>;
}

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly poolStateAddress: PublicKey;
  private dealSubscriptionId: number | null = null;
  private poolSubscriptionId: number | null = null;

  constructor(private readonly syncQueue: SyncQueueService) {
    this.connection = new Connection(INDEXER_ENV.rpcUrl, {
      commitment: "confirmed",
    });
    this.programId = new PublicKey(INDEXER_ENV.programId);
    this.poolStateAddress = INDEXER_ENV.poolStateAddress
      ? new PublicKey(INDEXER_ENV.poolStateAddress)
      : PublicKey.findProgramAddressSync(
          [Buffer.from("trade_finance"), Buffer.from("pool")],
          this.programId,
        )[0];
  }

  async onModuleInit(): Promise<void> {
    await this.startSubscriptions();
    await this.pullChainSnapshot();
  }

  private async startSubscriptions(): Promise<void> {
    this.dealSubscriptionId = this.connection.onProgramAccountChange(
      this.programId,
      (keyedAccountInfo: KeyedAccountInfo) => {
        void this.handleDealAccountChange(keyedAccountInfo);
      },
      "confirmed",
      [{ dataSize: TRADE_DEAL_ACCOUNT_SIZE }],
    );

    this.poolSubscriptionId = this.connection.onProgramAccountChange(
      this.programId,
      (keyedAccountInfo: KeyedAccountInfo) => {
        void this.handlePoolAccountChange(keyedAccountInfo);
      },
      "confirmed",
      [{ dataSize: POOL_STATE_ACCOUNT_SIZE }],
    );

    this.logger.log(
      `subscribed: deals=${this.dealSubscriptionId}, pool=${this.poolSubscriptionId}`,
    );
  }

  private async handleDealAccountChange(
    keyedAccountInfo: KeyedAccountInfo,
  ): Promise<void> {
    try {
      const payload = parseTradeDealBuffer(
        keyedAccountInfo.accountInfo.data,
        keyedAccountInfo.accountId.toBase58(),
      );
      await this.syncQueue.enqueueDealSync(payload);
    } catch (error) {
      this.logger.error(`deal account change failed: ${String(error)}`);
    }
  }

  private async handlePoolAccountChange(
    keyedAccountInfo: KeyedAccountInfo,
  ): Promise<void> {
    try {
      const payload = parsePoolStateBuffer(
        keyedAccountInfo.accountInfo.data,
        this.poolStateAddress.toBase58(),
      );
      await this.syncQueue.enqueuePoolSnapshot(payload);
    } catch (error) {
      this.logger.error(`pool account change failed: ${String(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async pullChainSnapshot(): Promise<void> {
    this.logger.log("fallback chain snapshot started");
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: "confirmed",
      filters: [{ dataSize: TRADE_DEAL_ACCOUNT_SIZE }],
    });

    for (const { pubkey, account } of accounts) {
      try {
        const payload = parseTradeDealBuffer(account.data, pubkey.toBase58());
        await this.syncQueue.enqueueDealSync(payload);
      } catch (error) {
        this.logger.warn(
          `skip deal account ${pubkey.toBase58()}: ${String(error)}`,
        );
      }
    }

    const poolInfo = await this.connection.getAccountInfo(
      this.poolStateAddress,
      "confirmed",
    );
    if (poolInfo) {
      const payload = parsePoolStateBuffer(
        poolInfo.data,
        this.poolStateAddress.toBase58(),
      );
      await this.syncQueue.enqueuePoolSnapshot(payload);
    }

    this.logger.log(
      `fallback chain snapshot done: ${accounts.length} deals synced`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dealSubscriptionId !== null) {
      await this.connection
        .removeProgramAccountChangeListener(this.dealSubscriptionId)
        .catch((error) =>
          this.logger.warn(`unsubscribe deal failed: ${String(error)}`),
        );
    }
    if (this.poolSubscriptionId !== null) {
      await this.connection
        .removeProgramAccountChangeListener(this.poolSubscriptionId)
        .catch((error) =>
          this.logger.warn(`unsubscribe pool failed: ${String(error)}`),
        );
    }
  }
}
