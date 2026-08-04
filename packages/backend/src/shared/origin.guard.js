"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OriginGuard = void 0;
const common_1 = require("@nestjs/common");
const LOCALHOST_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;
let OriginGuard = class OriginGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
            return true;
        }
        const origin = request.headers.origin;
        if (!origin) {
            return true;
        }
        const sameOrigin = typeof request.headers.host === "string" &&
            origin.startsWith(`${request.protocol}://${request.headers.host}`);
        const allowedOrigins = [
            LOCALHOST_ORIGIN,
            process.env.ALLOWED_ORIGIN,
        ].filter(Boolean);
        const allowed = allowedOrigins.some((candidate) => typeof candidate === "string"
            ? candidate === origin
            : candidate.test(origin));
        if (!sameOrigin && !allowed) {
            throw new common_1.ForbiddenException("跨域请求被拒绝");
        }
        return true;
    }
};
exports.OriginGuard = OriginGuard;
exports.OriginGuard = OriginGuard = __decorate([
    (0, common_1.Injectable)()
], OriginGuard);
//# sourceMappingURL=origin.guard.js.map