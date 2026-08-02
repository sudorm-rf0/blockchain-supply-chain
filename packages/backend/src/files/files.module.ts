import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttestationController } from "./attestation.controller";
import { AttestationService } from "./attestation.service";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({
  controllers: [FilesController, AttestationController],
  providers: [FilesService, AttestationService, PrismaService],
})
export class FilesModule {}
