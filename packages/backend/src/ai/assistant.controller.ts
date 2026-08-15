import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@supply-chain/common";
import { AssistantService } from "./assistant.service";
import { AiChatDto } from "./dto/ai-chat.dto";

@ApiTags("ai-assistant")
@Controller("api/ai")
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "AI 助手对话（平台操作引导与答疑）",
    description: "基于平台操作知识库回答用户问题；多轮对话传 sessionId 续聊，历史保存 30 天",
  })
  chat(@Body() dto: AiChatDto, @Req() req: Request) {
    return this.assistantService.chat(req.user!.sub, dto);
  }

  @Get("history")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "AI 助手历史会话列表" })
  listHistory(@Req() req: Request) {
    return this.assistantService.listHistory(req.user!.sub);
  }

  @Get("history/:sessionId")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "获取单个会话完整消息（恢复对话）" })
  getHistory(@Param("sessionId") sessionId: string, @Req() req: Request) {
    return this.assistantService.getHistory(req.user!.sub, sessionId);
  }

  @Delete("history")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "清空 AI 助手全部历史会话" })
  clearAll(@Req() req: Request) {
    return this.assistantService.deleteHistory(req.user!.sub);
  }

  @Delete("history/:sessionId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "删除单个历史会话" })
  deleteOne(@Param("sessionId") sessionId: string, @Req() req: Request) {
    return this.assistantService.deleteHistory(req.user!.sub, sessionId);
  }
}
