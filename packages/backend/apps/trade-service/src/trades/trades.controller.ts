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
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { CreateTradeResponseDto } from "./dto/create-trade-response.dto";
import { ConfirmTradeDto } from "./dto/confirm-trade.dto";
import { TradeItemDto } from "./dto/trade-item.dto";
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

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "当前用户相关订单列表" })
  list(@Req() req: Request): Promise<TradeItemDto[]> {
    return this.tradesService.listMyTrades(req.user!.sub);
  }

  @Post(":tradeId/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "确认创建订单交易已上链",
    description: "校验链上 create_deal 指令后回写 TradeDeal 记录",
  })
  confirm(
    @Param("tradeId") tradeId: string,
    @Body() dto: ConfirmTradeDto,
    @Req() req: Request,
  ) {
    return this.tradesService.confirmTrade(tradeId, dto, req.user!.sub);
  }
}
