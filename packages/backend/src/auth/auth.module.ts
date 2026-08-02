import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RedisService } from "../redis/redis.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, PrismaService, RedisService],
  exports: [AuthService, PrismaService, RedisService],
})
export class AuthModule {}
