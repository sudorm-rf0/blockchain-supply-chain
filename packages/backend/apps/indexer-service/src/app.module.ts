import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health/health.controller";
import { MetricsController } from "./observability/metrics.controller";
import { MetricsMiddleware } from "./observability/metrics.middleware";
import { MetricsService } from "./observability/metrics.service";
import { IndexerModule } from "./indexer/indexer.module";

@Module({
  imports: [ScheduleModule.forRoot(), IndexerModule],
  controllers: [HealthController, MetricsController],
  providers: [MetricsService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes("*");
  }
}
