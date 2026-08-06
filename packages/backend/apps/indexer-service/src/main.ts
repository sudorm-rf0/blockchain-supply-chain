import "dotenv/config";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "../../../src/shared/all-exceptions.filter";
import { initSentry } from "../../../src/shared/sentry";
import { assertStartupEnv, validateStartupEnv } from "../../../src/shared/env-check";
import { INDEXER_ENV } from "./config/env";

async function bootstrap(): Promise<void> {
  assertStartupEnv(validateStartupEnv({ required: ["DATABASE_URL"], redisRequired: true, rpcRequired: true }));
  initSentry("indexer-service");
  const app = await NestFactory.create(AppModule);
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

  await app.listen(INDEXER_ENV.port);
  Logger.log(`indexer-service listening on ${INDEXER_ENV.port}`, "Bootstrap");
}

void bootstrap();
