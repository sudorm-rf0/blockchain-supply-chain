import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { PoolOverviewResponseDto } from "./dto/pool-overview-response.dto";
import { WithdrawRequestDto } from "./dto/withdraw-request.dto";
import { WithdrawRequestResponseDto } from "./dto/withdraw-request-response.dto";
import { PoolService } from "./pool.service";

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
  @ApiOperation({
    summary: "LP 提款请求",
    description: "校验 7 天预告期并写入 Redis（7 天过期）",
  })
  @ApiCreatedResponse({ type: WithdrawRequestResponseDto })
  requestWithdrawal(
    @Body() dto: WithdrawRequestDto,
  ): Promise<WithdrawRequestResponseDto> {
    return this.poolService.requestWithdrawal(dto);
  }
}
