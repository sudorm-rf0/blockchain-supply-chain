import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { HealthController } from "./health/health.controller";
import { MetricsController } from "./observability/metrics.controller";
import { MetricsMiddleware } from "./observability/metrics.middleware";
import { MetricsService } from "./observability/metrics.service";
import { RequestIdMiddleware } from "./observability/request-id.middleware";
import { TradesModule } from "./trades/trades.module";

@Module({
  imports: [
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
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes("*");
  }
}
