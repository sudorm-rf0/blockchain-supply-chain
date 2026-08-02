import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health/health.controller";
import { PoolModule } from "./pool/pool.module";

@Module({
  imports: [ScheduleModule.forRoot(), PoolModule],
  controllers: [HealthController],
})
export class AppModule {}
