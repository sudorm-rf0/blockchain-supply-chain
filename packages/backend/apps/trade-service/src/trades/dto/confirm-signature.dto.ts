import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class ConfirmSignatureDto {
  @ApiProperty({
    description: "链上交易签名",
    example: "4xYJ...",
  })
  @IsString()
  txSignature!: string;
}
