import { TradeMetricsService } from "./trade-metrics.service";
import { Registry } from "prom-client";

function makeMetrics() {
  return { registry: new Registry() };
}

describe("TradeMetricsService", () => {
  it("updates the status gauge from the database", async () => {
    const prisma = {
      tradeDeal: {
        groupBy: jest.fn(async () => [
          { status: "PENDING", _count: 2 },
          { status: "SETTLED", _count: 5 },
        ]),
        count: jest.fn(async () => 7),
      },
    };
    const metrics = makeMetrics();
    const service = new TradeMetricsService(
      metrics as never,
      prisma as never,
    );
    await service.update();
    expect(prisma.tradeDeal.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      _count: true,
    });
  });
});
