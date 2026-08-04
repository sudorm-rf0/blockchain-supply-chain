"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestIdMiddleware = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const node_perf_hooks_1 = require("node:perf_hooks");
let RequestIdMiddleware = class RequestIdMiddleware {
    constructor() {
        this.logger = new common_1.Logger("HTTP");
    }
    use(req, res, next) {
        const requestId = req.headers["x-request-id"] || (0, node_crypto_1.randomUUID)();
        res.setHeader("X-Request-Id", requestId);
        const start = node_perf_hooks_1.performance.now();
        res.on("finish", () => {
            const status = res.statusCode;
            if (status >= 400 || Math.random() < 0.01) {
                this.logger.log(JSON.stringify({
                    level: "info",
                    method: req.method,
                    path: req.originalUrl,
                    status,
                    durationMs: Number((node_perf_hooks_1.performance.now() - start).toFixed(1)),
                    requestId,
                }));
            }
        });
        next();
    }
};
exports.RequestIdMiddleware = RequestIdMiddleware;
exports.RequestIdMiddleware = RequestIdMiddleware = __decorate([
    (0, common_1.Injectable)()
], RequestIdMiddleware);
//# sourceMappingURL=request-id.middleware.js.map