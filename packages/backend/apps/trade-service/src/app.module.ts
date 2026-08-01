import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { TradesModule } from "./trades/trades.module";

@Module({
  imports: [TradesModule],
  controllers: [HealthController],
})
export class AppModule {}
