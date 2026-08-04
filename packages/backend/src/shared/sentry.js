"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSentry = initSentry;
exports.isSentryEnabled = isSentryEnabled;
exports.captureException = captureException;
const Sentry = __importStar(require("@sentry/node"));
let enabled = false;
function initSentry(service = "backend") {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn)
        return;
    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV ?? "development",
        release: process.env.APP_VERSION ?? "0.1.0",
        serverName: service,
        tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
            ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
            : 0.1,
    });
    enabled = true;
}
function isSentryEnabled() {
    return enabled;
}
function captureException(error) {
    if (!enabled)
        return;
    Sentry.captureException(error);
}
//# sourceMappingURL=sentry.js.map