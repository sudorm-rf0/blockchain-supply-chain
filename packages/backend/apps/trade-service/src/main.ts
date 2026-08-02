import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { initSentry } from "./observability/sentry";
import { assertStartupEnv, validateStartupEnv } from "./config/env-check";
import { TRADE_ENV } from "./config/env";

async function bootstrap(): Promise<void> {
  assertStartupEnv(validateStartupEnv({ required: ["DATABASE_URL"], redisRequired: true, rpcRequired: true }));
  initSentry("trade-service");
  const app = await NestFactory.create(AppModule);
  app.use(compression());
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: [
      /^https?:\/\/localhost(:\d+)?$/,
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean) as (string | RegExp)[],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
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
