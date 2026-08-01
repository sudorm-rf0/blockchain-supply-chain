import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({
    origin: [
      /^https?:\/\/localhost(:\d+)?$/,
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean) as (string | RegExp)[],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-name"],
  });
  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads/",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      } else if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
        res.setHeader("Content-Type", "text/plain");
      }
    },
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
