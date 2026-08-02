import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { CreateTradeResponseDto } from "./dto/create-trade-response.dto";
import { TradesService } from "./trades.service";

@ApiTags("trades")
@Controller("api/trades")
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "预构建创建贸易订单交易",
    description: "校验用户权限并计算 30% 首付/70% 垫付，返回待签名交易",
  })
  @ApiCreatedResponse({ type: CreateTradeResponseDto })
  create(
    @Body() dto: CreateTradeDto,
    @Req() req: Request,
  ): Promise<CreateTradeResponseDto> {
    return this.tradesService.createTrade(dto, req.user!.sub);
  }
}
