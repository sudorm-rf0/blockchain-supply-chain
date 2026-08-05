import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard } from "@supply-chain/common";
import { AdminGuard } from "@supply-chain/common";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { CreateTradeResponseDto } from "./dto/create-trade-response.dto";
import { ConfirmTradeDto } from "./dto/confirm-trade.dto";
import { ConfirmSignatureDto } from "./dto/confirm-signature.dto";
import { AdvanceTradeDto } from "./dto/advance-trade.dto";
import { FundTradeDto } from "./dto/fund-trade.dto";
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
  list(
    @Req() req: Request,
    @Query("search") search?: string,
    @Query("status") status?: string,
  ): Promise<TradeItemDto[]> {
    return this.tradesService.listMyTrades(req.user!.sub, { search, status });
  }

  @Get("admin")
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "全部订单列表（管理员）" })
  listAll(
    @Req() req: Request,
    @Query("search") search?: string,
    @Query("status") status?: string,
  ): Promise<TradeItemDto[]> {
    return this.tradesService.listAllTrades(req.user!.sub, { search, status });
  }

  @Get(":tradeId")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "订单详情（管理员或订单参与方）" })
  getOne(@Param("tradeId") tradeId: string, @Req() req: Request) {
    return this.tradesService.getTrade(tradeId, req.user!.sub);
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

  @Post(":tradeId/fund")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "预构建资金池拨款交易（管理员）" })
  fund(
    @Param("tradeId") tradeId: string,
    @Body() dto: FundTradeDto,
    @Req() req: Request,
  ) {
    return this.tradesService.buildFundTrade(tradeId, dto, req.user!.sub);
  }

  @Post(":tradeId/fund/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "确认拨款交易已上链" })
  confirmFund(
    @Param("tradeId") tradeId: string,
    @Body() dto: ConfirmSignatureDto,
    @Req() req: Request,
  ) {
    return this.tradesService.confirmFundTrade(tradeId, dto, req.user!.sub);
  }

  @Post(":tradeId/advance")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "预构建物流状态推进交易（管理员）" })
  advance(
    @Param("tradeId") tradeId: string,
    @Body() dto: AdvanceTradeDto,
    @Req() req: Request,
  ) {
    return this.tradesService.buildAdvanceTrade(tradeId, dto, req.user!.sub);
  }

  @Post(":tradeId/advance/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "确认物流状态推进交易已上链" })
  confirmAdvance(
    @Param("tradeId") tradeId: string,
    @Body() dto: AdvanceTradeDto & ConfirmSignatureDto,
    @Req() req: Request,
  ) {
    return this.tradesService.confirmAdvanceTrade(
      tradeId,
      dto,
      req.user!.sub,
    );
  }

  @Post(":tradeId/repay")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "预构建买方还款交易" })
  repay(
    @Param("tradeId") tradeId: string,
    @Req() req: Request,
  ) {
    return this.tradesService.buildRepayTrade(tradeId, req.user!.sub);
  }

  @Post(":tradeId/repay/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "确认还款交易已上链" })
  confirmRepay(
    @Param("tradeId") tradeId: string,
    @Body() dto: ConfirmSignatureDto,
    @Req() req: Request,
  ) {
    return this.tradesService.confirmRepayTrade(
      tradeId,
      dto,
      req.user!.sub,
    );
  }

  @Post(":tradeId/default")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "预构建违约清算交易（管理员）" })
  defaultDeal(
    @Param("tradeId") tradeId: string,
    @Body() dto: FundTradeDto,
    @Req() req: Request,
  ) {
    return this.tradesService.buildDefaultTrade(tradeId, dto, req.user!.sub);
  }

  @Post(":tradeId/default/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "确认违约清算交易已上链" })
  confirmDefault(
    @Param("tradeId") tradeId: string,
    @Body() dto: ConfirmSignatureDto,
    @Req() req: Request,
  ) {
    return this.tradesService.confirmDefaultTrade(
      tradeId,
      dto,
      req.user!.sub,
    );
  }

  @Post(":tradeId/release")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "预构建释放托管资金交易（管理员）" })
  release(
    @Param("tradeId") tradeId: string,
    @Body() dto: FundTradeDto,
    @Req() req: Request,
  ) {
    return this.tradesService.buildReleaseTrade(tradeId, dto, req.user!.sub);
  }

  @Post(":tradeId/release/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AdminGuard)
  @ApiOperation({ summary: "确认释放托管资金交易已上链" })
  confirmRelease(
    @Param("tradeId") tradeId: string,
    @Body() dto: ConfirmSignatureDto,
    @Req() req: Request,
  ) {
    return this.tradesService.confirmReleaseTrade(
      tradeId,
      dto,
      req.user!.sub,
    );
  }
}
