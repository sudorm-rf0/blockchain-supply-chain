import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";

export class AiChatDto {
  @ApiProperty({ description: "用户对单据的提问", example: "这份合同的风险点有哪些？" })
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
}
