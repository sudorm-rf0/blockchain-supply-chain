import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
} from "@nestjs/common";
import { MetricsService } from "./shared/metrics.service";

/** CSP report 端点输入防护（审计 2026-08-31）：拒绝非 CSP Content-Type 与超大 body，
 * 防止日志污染/刷量掩盖真实安全事件。 */
const MAX_CSP_BODY_BYTES = 16 * 1024; // 16KB
const ALLOWED_CSP_CONTENT_TYPES = [
  "application/csp-report",
  "application/json",
  "application/reports+json",
];

interface CspReportData {
  directive: string;
  disposition: string;
  blockedUri: string;
  sourceFile: string;
}

function normalize(value: unknown): string {
  const raw = String(value ?? "unknown").trim();
  return raw ? raw.slice(0, 64) : "unknown";
}

function extractReport(body: unknown): CspReportData {
  const root = (body ?? {}) as Record<string, unknown>;
  const legacy = (root["csp-report"] ?? root) as Record<string, unknown>;
  const modern =
    root.body && typeof root.body === "object"
      ? (root.body as Record<string, unknown>)
      : legacy;
  return {
    directive: normalize(
      modern["effective-directive"] ??
        modern["violated-directive"] ??
        modern.effectiveDirective ??
        modern.violatedDirective,
    ),
    disposition: normalize(modern.disposition ?? "enforce"),
    blockedUri: normalize(modern["blocked-uri"] ?? modern.blockedURL),
    sourceFile: normalize(modern["source-file"] ?? modern.sourceFile),
  };
}

@Controller("api/csp-report")
export class CspReportController {
  private readonly logger = new Logger("CspReport");

  constructor(private readonly metrics: MetricsService) {}

  @Post()
  @HttpCode(204)
  cspReport(
    @Body() body: unknown,
    @Headers("content-type") contentType?: string,
    @Headers("content-length") contentLength?: string,
  ) {
    if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
      throw new BadRequestException("empty CSP report");
    }
    const ct = (contentType ?? "").toLowerCase().split(";")[0].trim();
    if (ct && !ALLOWED_CSP_CONTENT_TYPES.includes(ct)) {
      throw new BadRequestException("unsupported content-type");
    }
    const len = Number(contentLength ?? 0);
    if (len > MAX_CSP_BODY_BYTES) {
      throw new BadRequestException("CSP report too large");
    }
    const { directive, disposition, blockedUri, sourceFile } =
      extractReport(body);
    this.metrics.recordCspViolation(directive, disposition);
    this.logger.warn(
      `CSP violation directive=${directive} disposition=${disposition} blockedUri=${blockedUri} sourceFile=${sourceFile}`,
    );
  }
}
