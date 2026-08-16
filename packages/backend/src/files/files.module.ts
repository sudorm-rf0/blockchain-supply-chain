import { Module } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttestationController } from "./attestation.controller";
import { AttestationService } from "./attestation.service";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { ScanService } from "../security/scan.service";
import { FilesAnalysisService } from "./files-analysis.service";
import { FilesTranslationService } from "./files-translation.service";
import { FilesAiService } from "./files-ai.service";
import { AiModule } from "../ai/ai.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  controllers: [FilesController, AttestationController],
  imports: [StorageModule, AuditModule, AuthModule, AiModule, NotificationsModule],
  providers: [FilesService, AttestationService, FilesAnalysisService, FilesTranslationService, FilesAiService, PrismaService, ScanService, RedisService],
})
export class FilesModule {}
