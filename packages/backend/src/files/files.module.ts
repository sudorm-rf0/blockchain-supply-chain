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

@Module({
  controllers: [FilesController, AttestationController],
  imports: [StorageModule, AuditModule, AuthModule],
  providers: [FilesService, AttestationService, PrismaService, ScanService],
})
export class FilesModule {}
