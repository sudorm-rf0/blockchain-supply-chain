"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllExceptionsFilter = void 0;
const common_1 = require("@nestjs/common");
const sentry_1 = require("./sentry");
let AllExceptionsFilter = class AllExceptionsFilter {
    constructor() {
        this.logger = new common_1.Logger("Exceptions");
    }
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const status = exception instanceof common_1.HttpException
            ? exception.getStatus()
            : common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        const body = exception instanceof common_1.HttpException
            ? exception.getResponse()
            : { message: "Internal server error" };
        const rawMessage = typeof body === "string"
            ? body
            : body?.message;
        let message = typeof rawMessage === "string"
            ? rawMessage
            : JSON.stringify(rawMessage ?? "Internal server error");
        if (typeof message === "string" && message.startsWith('"') && message.endsWith('"')) {
            try {
                message = JSON.parse(message);
            }
            catch {
            }
        }
        const requestId = response.getHeader("X-Request-Id") ??
            request.headers["x-request-id"] ??
            undefined;
        if (status === 429 && message.includes("Throttler")) {
            message = "请求过于频繁，请稍后再试";
        }
        if (status >= 500) {
            (0, sentry_1.captureException)(exception);
            this.logger.error(`${request.method} ${request.originalUrl} ${status} id=${requestId ?? "-"}`, exception instanceof Error ? exception.stack : undefined);
        }
        response.status(status).json({
            statusCode: status,
            message,
            error: typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
                ? body.error
                : undefined,
            requestId,
            timestamp: new Date().toISOString(),
        });
    }
};
exports.AllExceptionsFilter = AllExceptionsFilter;
exports.AllExceptionsFilter = AllExceptionsFilter = __decorate([
    (0, common_1.Catch)()
], AllExceptionsFilter);
//# sourceMappingURL=all-exceptions.filter.js.map