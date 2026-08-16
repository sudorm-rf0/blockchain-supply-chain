import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, AdminGuard } from "@supply-chain/common";
import { FeedbackService } from "./feedback.service";

@ApiTags("admin-feedback")
@Controller("api/admin/feedback")
@UseGuards(AuthGuard, AdminGuard)
export class AdminFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  @ApiOperation({ summary: "意见反馈列表（管理员）" })
  list(@Query("status") status?: string) {
    return this.feedbackService.list(status);
  }

  @Post(":id/process")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "标记反馈已处理（管理员）" })
  markProcessed(@Param("id") id: string) {
    return this.feedbackService.markProcessed(id);
  }
}
