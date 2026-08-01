import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { CreateTradeResponseDto } from "./dto/create-trade-response.dto";
import { TradesService } from "./trades.service";

@ApiTags("trades")
@Controller("api/trades")
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "预构建创建贸易订单交易",
    description: "校验用户权限并计算 30% 首付/70% 垫付，返回待签名交易",
  })
  @ApiCreatedResponse({ type: CreateTradeResponseDto })
  create(
    @Body() dto: CreateTradeDto,
    @Headers("x-wallet-address") wallet: string | undefined,
  ): Promise<CreateTradeResponseDto> {
    return this.tradesService.createTrade(dto, wallet);
  }
}
