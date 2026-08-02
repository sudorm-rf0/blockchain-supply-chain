import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { PoolController } from "./pool.controller";
import { PoolService } from "./pool.service";
import { WithdrawalWorkerService } from "./withdrawal-worker.service";

@Module({
  controllers: [PoolController],
  providers: [PoolService, WithdrawalWorkerService, PrismaService, RedisService],
})
export class PoolModule {}
