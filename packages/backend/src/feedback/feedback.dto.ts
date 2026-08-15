import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class SubmitFeedbackDto {
  @ApiProperty({
    description: "反馈内容",
    example: "AI 审核建议增加发票 OCR 识别准确率提示。",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({
    description: "联系方式（选填，用于回复）",
    example: "user@example.com",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string;
}
