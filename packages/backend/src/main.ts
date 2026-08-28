import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./shared/all-exceptions.filter";
import { initSentry } from "./shared/sentry";
import { assertStartupEnv, validateStartupEnv } from "./shared/env-check";

async function bootstrap() {
  assertStartupEnv(validateStartupEnv({ required: ["DATABASE_URL"], secrets: ["JWT_SECRET", "WEBHOOK_SECRET"], redisRequired: true, rpcRequired: true }));
  initSentry("backend");
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // H-3：nginx 反代后还原真实客户端 IP（登录防暴破/限流依赖 req.ip）
  // 只信任最近一跳代理（nginx）：客户端伪造 X-Forwarded-For 不再被采纳，
  // request.ip = nginx 覆盖后的真实 IP（审计 P0-1：XFF 信任/限速绕过/Origin 回环豁免）。
  app.set("trust proxy", 1);
  app.use(compression());
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [
      /^https?:\/\/localhost(:\d+)?$/,
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean) as (string | RegExp)[],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle("Supply Chain Backend API")
    .setDescription("文件上传、审核与 Solana 存证 API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  // L4：生产环境禁用 Swagger/OpenAPI 文档（避免暴露全部路由与 DTO 结构）
  if ((process.env.NODE_ENV ?? "").trim() !== "production") {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api-docs", app, document);
  }

  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
