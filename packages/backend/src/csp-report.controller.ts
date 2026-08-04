import { Body, Controller, HttpCode, Logger, Post } from "@nestjs/common";

@Controller("api/csp-report")
export class CspReportController {
  private readonly logger = new Logger("CspReport");

  @Post()
  @HttpCode(204)
  cspReport(@Body() body: unknown) {
    const report = JSON.stringify(body ?? {}).slice(0, 500);
    this.logger.warn(`CSP violation report: ${report}`);
  }
}
