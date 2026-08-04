import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { captureException } from "./sentry";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: "Internal server error" };
    const rawMessage =
      typeof body === "string"
        ? body
        : (body as Record<string, unknown> | null)?.message;
    let message =
      typeof rawMessage === "string"
        ? rawMessage
        : JSON.stringify(rawMessage ?? "Internal server error");
    if (typeof message === "string" && message.startsWith('"') && message.endsWith('"')) {
      try {
        message = JSON.parse(message) as string;
      } catch {
        // keep the raw string when it is not valid JSON.
      }
    }
    const requestId =
      response.getHeader("X-Request-Id") ??
      request.headers["x-request-id"] ??
      undefined;

    if (status === 429 && message.includes("Throttler")) {
      message = "请求过于频繁，请稍后再试";
    }

    if (status >= 500) {
      captureException(exception);
      this.logger.error(
        `${request.method} ${request.originalUrl} ${status} id=${requestId ?? "-"}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      error:
        typeof body === "object" && body !== null && "error" in body && typeof (body as Record<string, unknown>).error === "string"
          ? ((body as Record<string, unknown>).error as string)
          : undefined,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
