import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { initSentry } from "./observability/sentry";
import { assertStartupEnv, validateStartupEnv } from "./config/env-check";
import { POOL_ENV } from "./config/env";

async function bootstrap(): Promise<void> {
  assertStartupEnv(validateStartupEnv({ required: ["DATABASE_URL"], redisRequired: true, rpcRequired: true }));
  initSentry("pool-service");
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

  const config = new DocumentBuilder()
    .setTitle("pool-service")
    .setDescription("Pool overview and LP withdrawal request API")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);


    await app.listen(POOL_ENV.port);
  Logger.log(`pool-service listening on ${POOL_ENV.port}`, "Bootstrap");
}

void bootstrap();
