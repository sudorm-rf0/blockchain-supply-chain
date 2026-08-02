import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ReviewFileDto {
  @IsIn(["APPROVED", "REJECTED"])
  status!: "APPROVED" | "REJECTED";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
