import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { PoolModule } from "./pool/pool.module";

@Module({
  imports: [PoolModule],
  controllers: [HealthController],
})
export class AppModule {}
