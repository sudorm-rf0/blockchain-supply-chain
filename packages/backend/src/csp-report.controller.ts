import { Body, Controller, HttpCode, Logger, Post } from "@nestjs/common";
import { MetricsService } from "./shared/metrics.service";

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
  cspReport(@Body() body: unknown) {
    const { directive, disposition, blockedUri, sourceFile } =
      extractReport(body);
    this.metrics.recordCspViolation(directive, disposition);
    this.logger.warn(
      `CSP violation directive=${directive} disposition=${disposition} blockedUri=${blockedUri} sourceFile=${sourceFile}`,
    );
  }
}
