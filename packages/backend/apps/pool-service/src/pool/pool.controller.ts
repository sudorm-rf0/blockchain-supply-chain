import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { PoolOverviewResponseDto } from "./dto/pool-overview-response.dto";
import { WithdrawRequestDto } from "./dto/withdraw-request.dto";
import { WithdrawRequestResponseDto } from "./dto/withdraw-request-response.dto";
import { ExecuteWithdrawDto } from "./dto/execute-withdraw.dto";
import { RedeemLpDto } from "./dto/redeem-lp.dto";
import { ConfirmRedeemDto } from "./dto/confirm-redeem.dto";
import { PoolService } from "./pool.service";
import { AuthGuard } from "../auth/auth.guard";

@ApiTags("pool")
@Controller("api")
export class PoolController {
  constructor(private readonly poolService: PoolService) {}

  @Get("pool/overview")
  @ApiOperation({
    summary: "资金池总览",
    description: "返回最新 PoolSnapshot、TradeDeal 汇总与实时 APR",
  })
  @ApiOkResponse({ type: PoolOverviewResponseDto })
  getOverview(): Promise<PoolOverviewResponseDto> {
    return this.poolService.getOverview();
  }

  @Post("lp/withdraw-request")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "LP 提款请求",
    description: "校验 7 天预告期并写入 Redis（7 天过期）",
  })
  @ApiCreatedResponse({ type: WithdrawRequestResponseDto })
  requestWithdrawal(
    @Body() dto: WithdrawRequestDto,
    @Req() req: Request,
  ): Promise<WithdrawRequestResponseDto> {
    return this.poolService.requestWithdrawal(dto, req.user!.sub);
  }

  @Post("lp/withdraw-request/:id/execute")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "管理员执行 READY 提款" })
  executeWithdrawal(
    @Param("id") id: string,
    @Body() dto: ExecuteWithdrawDto,
    @Req() req: Request,
  ) {
    return this.poolService.executeWithdrawal(id, dto, req.user!.sub);
  }

  @Post("lp/redeem")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "预构建 LP 链上赎回交易" })
  redeemLp(@Body() dto: RedeemLpDto, @Req() req: Request) {
    return this.poolService.buildRedeemLp(dto, req.user!.sub);
  }

  @Post("lp/redeem/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "确认 LP 赎回交易已上链" })
  confirmRedeemLp(@Body() dto: ConfirmRedeemDto, @Req() req: Request) {
    return this.poolService.confirmRedeemLp(dto, req.user!.sub);
  }
}
