import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttestationController } from "./attestation.controller";
import { AttestationService } from "./attestation.service";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  controllers: [FilesController, AttestationController],
  imports: [StorageModule, AuditModule],
  providers: [FilesService, AttestationService, PrismaService],
})
export class FilesModule {}
