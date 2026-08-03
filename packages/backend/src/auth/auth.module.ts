import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { RedisService } from "../redis/redis.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PrismaService, RedisService],
  exports: [AuthService, AuthGuard, PrismaService, RedisService],
})
export class AuthModule {}
