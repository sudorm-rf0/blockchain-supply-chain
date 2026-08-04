import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { OriginGuard } from "../../../src/shared/origin.guard";
import { HealthController } from "./health/health.controller";
import { MetricsController } from "../../../src/shared/metrics.controller";
import { MetricsMiddleware } from "../../../src/shared/metrics.middleware";
import { MetricsService } from "../../../src/shared/metrics.service";
import { RequestIdMiddleware } from "../../../src/shared/request-id.middleware";
import { TradesModule } from "./trades/trades.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      },
    ]),
    TradesModule,
  ],
  controllers: [HealthController, MetricsController],
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
