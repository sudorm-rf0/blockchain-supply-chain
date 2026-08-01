import { Module } from "@nestjs/common";
import { TradesModule } from "./trades/trades.module";

@Module({
  imports: [TradesModule],
})
export class AppModule {}
