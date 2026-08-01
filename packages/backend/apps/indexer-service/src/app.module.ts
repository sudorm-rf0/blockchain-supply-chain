import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { IndexerModule } from "./indexer/indexer.module";

@Module({
  imports: [ScheduleModule.forRoot(), IndexerModule],
})
export class AppModule {}
