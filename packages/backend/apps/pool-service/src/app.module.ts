import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { OriginGuard } from "../../../src/shared/origin.guard";
import { createHealthController } from "@supply-chain/common";
import { MetricsController } from "../../../src/shared/metrics.controller";
import { MetricsMiddleware } from "../../../src/shared/metrics.middleware";
import { MetricsService } from "../../../src/shared/metrics.service";
import { RequestIdMiddleware } from "../../../src/shared/request-id.middleware";
import { PoolModule } from "./pool/pool.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      },
    ]),
    PoolModule,
  ],
  controllers: [createHealthController("pool-service"), MetricsController],
  providers: [
    MetricsService,
    {
      provide: APP_GUARD,
      useClass: OriginGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes("*");
  }
}
