import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class AiCompareDto {
  @ApiProperty({ description: "待比对的另一份单据文件 id", example: "f2" })
  @IsString()
  compareFileId!: string;
}
