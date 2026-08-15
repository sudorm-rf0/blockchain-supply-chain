import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@supply-chain/common";
import { FeedbackService } from "./feedback.service";
import { SubmitFeedbackDto } from "./feedback.dto";

@ApiTags("feedback")
@Controller("api/feedback")
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "提交意见反馈",
    description: "反馈内容通过邮件发送到平台管理员（收件邮箱仅服务端配置，不对外暴露）",
  })
  submit(@Body() dto: SubmitFeedbackDto, @Req() req: Request) {
    const user = req.user as { sub: string; email?: string | null } | undefined;
    return this.feedbackService.submit(user!.sub, user?.email ?? null, dto);
  }
}
