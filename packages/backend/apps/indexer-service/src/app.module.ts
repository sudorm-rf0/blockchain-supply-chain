import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health/health.controller";
import { MetricsMiddleware } from "../../../src/shared/metrics.middleware";
import { MetricsService } from "../../../src/shared/metrics.service";
import { RequestIdMiddleware } from "../../../src/shared/request-id.middleware";
import { IndexerModule } from "./indexer/indexer.module";

@Module({
  imports: [ScheduleModule.forRoot(), IndexerModule],
  controllers: [HealthController],
  providers: [MetricsService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes("*");
  }
}
