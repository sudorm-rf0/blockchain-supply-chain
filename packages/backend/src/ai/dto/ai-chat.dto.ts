import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";

export class AiChatDto {
  @ApiProperty({ description: "用户提问", example: "如何创建一笔贸易订单？" })
  @IsString()
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({
    description: "历史对话（可选，多轮上下文；服务端会清洗角色与长度）",
    example: [{ role: "user", content: "..." }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  history?: Array<{ role: string; content: string }>;

  @ApiPropertyOptional({
    description: "会话 ID（多轮对话续聊时传入；不传则新建会话）",
    example: "6f2a4b7c-...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @ApiPropertyOptional({
    description: "界面语言（zh-CN / zh-TW / en），用于让 AI 用对应语言回复",
    example: "zh-CN",
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  lang?: string;
}
