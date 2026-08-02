import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { AttestationService } from "./attestation.service";
import {
  AttestDocumentDto,
  ConfirmAttestDocumentDto,
} from "./dto/attest-document.dto";

@ApiTags("files")
@Controller("api/files")
export class AttestationController {
  constructor(private readonly attestationService: AttestationService) {}

  @Post(":id/attest")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "预构建单据存证交易",
    description: "将文件 SHA-256 哈希写入 Solana DocumentRecord PDA",
  })
  attest(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: AttestDocumentDto,
  ) {
    return this.attestationService.build(id, req.user!.sub, body);
  }

  @Post(":id/attest/confirm")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "确认单据存证交易",
    description: "前端签名上链后回写交易签名与单据 PDA",
  })
  confirm(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: ConfirmAttestDocumentDto,
  ) {
    return this.attestationService.confirm(id, req.user!.sub, body);
  }
}
