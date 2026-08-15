import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
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
    description: "基于平台操作知识库回答用户问题并分步引导",
  })
  chat(@Body() dto: AiChatDto, @Req() req: Request) {
    return this.assistantService.chat(req.user!.sub, dto);
  }
}
