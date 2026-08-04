import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from "class-validator";

export class BatchReviewDto {
  @ApiProperty({ type: [String], example: ["file-1", "file-2"] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  ids!: string[];

  @ApiProperty({ enum: ["APPROVED", "REJECTED"] })
  @IsIn(["APPROVED", "REJECTED"])
  status!: "APPROVED" | "REJECTED";

  @ApiPropertyOptional({ example: "批量审核" })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  confirm!: boolean;
}
