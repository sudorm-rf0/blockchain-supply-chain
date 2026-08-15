import { Module } from "@nestjs/common";
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

@Module({
  controllers: [FilesController, AttestationController],
  imports: [StorageModule, AuditModule, AuthModule],
  providers: [FilesService, AttestationService, FilesAnalysisService, FilesTranslationService, FilesAiService, PrismaService, ScanService],
})
export class FilesModule {}
