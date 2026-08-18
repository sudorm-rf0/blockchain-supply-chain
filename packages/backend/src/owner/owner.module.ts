import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { OwnerPanelController } from "./owner-panel.controller";
import { VisitLogService } from "./visit-log.service";
import { VisitsInterceptor } from "./visits.interceptor";

@Module({
  imports: [AuthModule],
  controllers: [OwnerPanelController],
  providers: [
    VisitLogService,
    PrismaService,
    { provide: APP_INTERCEPTOR, useClass: VisitsInterceptor },
  ],
})
export class OwnerPanelModule {}
