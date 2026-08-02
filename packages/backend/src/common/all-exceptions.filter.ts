import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

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
        ? (exception.getResponse() as Record<string, unknown>)
        : { message: "Internal server error" };
    const message =
      typeof body.message === "string"
        ? body.message
        : JSON.stringify(body.message ?? "Internal server error");
    const requestId =
      response.getHeader("X-Request-Id") ??
      request.headers["x-request-id"] ??
      undefined;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} ${status} id=${requestId ?? "-"}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: typeof body.error === "string" ? body.error : undefined,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
