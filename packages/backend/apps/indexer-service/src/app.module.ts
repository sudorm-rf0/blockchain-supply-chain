import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health/health.controller";
import { IndexerModule } from "./indexer/indexer.module";

@Module({
  imports: [ScheduleModule.forRoot(), IndexerModule],
  controllers: [HealthController],
})
export class AppModule {}
