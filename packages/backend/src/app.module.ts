import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { FilesModule } from "./files/files.module";

@Module({
  imports: [AuthModule, FilesModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
