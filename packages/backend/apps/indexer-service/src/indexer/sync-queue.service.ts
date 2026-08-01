import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { INDEXER_ENV } from "../config/env";
import {
  DEAL_SYNC_JOB,
  POOL_SNAPSHOT_JOB,
  DealSyncPayload,
  PoolSnapshotPayload,
} from "./payloads";
import { createBullConnection } from "./redis-connection";

@Injectable()
export class SyncQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SyncQueueService.name);
  readonly queue: Queue;

  constructor() {
    this.queue = new Queue(INDEXER_ENV.syncQueueName, {
      connection: createBullConnection(INDEXER_ENV.redisUrl),
    });
    this.logger.log(`sync queue ready: ${INDEXER_ENV.syncQueueName}`);
  }

  async enqueueDealSync(payload: DealSyncPayload): Promise<void> {
    await this.queue.add(DEAL_SYNC_JOB, payload, {
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    });
  }

  async enqueuePoolSnapshot(payload: PoolSnapshotPayload): Promise<void> {
    await this.queue.add(POOL_SNAPSHOT_JOB, payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { count: 2_000 },
      removeOnFail: { count: 2_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
