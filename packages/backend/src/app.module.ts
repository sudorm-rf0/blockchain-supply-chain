import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { OriginGuard } from "./shared/origin.guard";
import { AppController } from "./app.controller";
import { CspReportController } from "./csp-report.controller";
import { AdminStatsController } from "./admin/admin.controller";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { FilesModule } from "./files/files.module";
import { SupplyChainModule } from "./supply-chain/supply-chain.module";
import { MetricsController } from "./shared/metrics.controller";
import { MetricsMiddleware } from "./shared/metrics.middleware";
import { MetricsService } from "./shared/metrics.service";
import { RequestIdMiddleware } from "./shared/request-id.middleware";
import { PrismaService } from "./prisma/prisma.service";
import { RedisService } from "./redis/redis.service";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      },
    ]),
    AuthModule,
    AuditModule,
    FilesModule,
    SupplyChainModule,
  ],
  controllers: [
    AppController,
    CspReportController,
    MetricsController,
    AdminStatsController,
  ],
  providers: [
    PrismaService,
    RedisService,
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
