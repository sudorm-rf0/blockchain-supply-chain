import "dotenv/config";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "../../../src/shared/all-exceptions.filter";
import { initSentry } from "../../../src/shared/sentry";
import { assertStartupEnv, validateStartupEnv } from "../../../src/shared/env-check";
import { TRADE_ENV } from "./config/env";

async function bootstrap(): Promise<void> {
  assertStartupEnv(validateStartupEnv({ required: ["DATABASE_URL"], secrets: ["WEBHOOK_SECRET"], redisRequired: true, rpcRequired: true }));
  initSentry("trade-service");
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // H-3：nginx 反代后还原真实客户端 IP（登录防暴破/限流依赖 req.ip）
  // 只信任最近一跳代理（nginx）：客户端伪造 X-Forwarded-For 不再被采纳（审计 P0-1）
  app.set("trust proxy", 1);
  app.use(compression());
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: [
      /^https?:\/\/localhost(:\d+)?$/,
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean) as (string | RegExp)[],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle("trade-service")
    .setDescription("Trade finance pre-build transaction API")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  await app.listen(TRADE_ENV.port);
  Logger.log(`trade-service listening on ${TRADE_ENV.port}`, "Bootstrap");
}

void bootstrap();
