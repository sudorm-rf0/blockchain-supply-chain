import { Module } from "@nestjs/common";
import { PoolModule } from "./pool/pool.module";

@Module({
  imports: [PoolModule],
})
export class AppModule {}
