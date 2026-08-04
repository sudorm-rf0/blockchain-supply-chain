import { CspReportController } from "./csp-report.controller";
import { MetricsService } from "./shared/metrics.service";

describe("CspReportController", () => {
  it("counts legacy CSP report format", async () => {
    const metrics = new MetricsService();
    const controller = new CspReportController(metrics);

    controller.cspReport({
      "csp-report": {
        "effective-directive": "script-src",
        disposition: "enforce",
        "blocked-uri": "https://evil.example/x.js",
      },
    });

    const output = await metrics.metrics();
    expect(output).toContain(
      'csp_violations_total{directive="script-src",disposition="enforce"} 1',
    );
  });

  it("counts Reporting API format", async () => {
    const metrics = new MetricsService();
    const controller = new CspReportController(metrics);

    controller.cspReport({
      type: "csp-violation",
      body: {
        effectiveDirective: "img-src",
        disposition: "report",
        blockedURL: "https://cdn.example/a.png",
      },
    });

    const output = await metrics.metrics();
    expect(output).toContain(
      'csp_violations_total{directive="img-src",disposition="report"} 1',
    );
  });
});
