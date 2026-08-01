import { ApiProperty } from "@nestjs/swagger";

export class WithdrawRequestResponseDto {
  @ApiProperty({ description: "处理队列 ID", example: "3f7c0f86-..." })
  queueId!: string;

  @ApiProperty({ example: "PENDING" })
  status!: string;

  @ApiProperty({ example: 7 })
  noticeDays!: number;

  @ApiProperty({ example: "2026-08-09T00:00:00.000Z" })
  unlockAt!: string;
}
