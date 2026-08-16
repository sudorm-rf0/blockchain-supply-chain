import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { AuthGuard, AdminGuard } from "@supply-chain/common";
import { FinancingService } from "./financing.service";
import { ApplyFinancingDto } from "./dto/apply-financing.dto";
import { ApproveFinancingDto } from "./dto/approve-financing.dto";
import { RepayFinancingDto } from "./dto/repay-financing.dto";

@Controller("api/financing")
export class FinancingController {
  constructor(private readonly financing: FinancingService) {}

  @Post("apply")
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  apply(@Body() body: ApplyFinancingDto, @Req() req: Request) {
    return this.financing.apply(req.user!.sub, body);
  }

  @Get("mine")
  @UseGuards(AuthGuard)
  mine(@Req() req: Request) {
    return this.financing.mine(req.user!.sub);
  }

  @Get("admin")
  @UseGuards(AuthGuard, AdminGuard)
  adminList() {
    return this.financing.adminList();
  }

  @Post(":id/approve")
  @UseGuards(AuthGuard, AdminGuard)
  approve(@Param("id") id: string, @Body() body: ApproveFinancingDto, @Req() req: Request) {
    return this.financing.approve(id, req.user!.sub, body);
  }

  @Post(":id/reject")
  @UseGuards(AuthGuard, AdminGuard)
  reject(@Param("id") id: string, @Req() req: Request) {
    return this.financing.reject(id, req.user!.sub);
  }

  @Post(":id/repay")
  @UseGuards(AuthGuard)
  repay(@Param("id") id: string, @Body() body: RepayFinancingDto, @Req() req: Request) {
    return this.financing.repay(id, req.user!.sub, body);
  }
}
