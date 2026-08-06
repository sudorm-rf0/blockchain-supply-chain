import { StreamableFile } from "@nestjs/common";
import { Readable } from "node:stream";
import { AuditController } from "./audit.controller";

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    list: jest.fn(async (params: unknown) => ({
      items: [],
      total: 0,
      ...(params as object),
    })),
    exportCsv: jest.fn(() => Readable.from(['"id","createdAt"\n"1","2026-01-01"'])),
    ...overrides,
  };
}

describe("AuditController", () => {
  it("parses list query params with clamps", async () => {
    const svc = makeService();
    const ctrl = new AuditController(svc as never);
    await ctrl.list("2", "50", "LOGIN", "AUTH");
    expect(svc.list).toHaveBeenCalledWith({
      page: 2,
      limit: 50,
      action: "LOGIN",
      targetType: "AUTH",
    });
    await ctrl.list("0", "9999");
    expect(svc.list).toHaveBeenLastCalledWith({
      page: 1,
      limit: 100,
      action: undefined,
      targetType: undefined,
    });
  });

  it("returns a StreamableFile from exportCsv", () => {
    const svc = makeService();
    const ctrl = new AuditController(svc as never);
    const result = ctrl.exportCsv(undefined, undefined, "10000");
    expect(svc.exportCsv).toHaveBeenCalledWith({
      action: undefined,
      targetType: undefined,
      limit: 10_000,
    });
    expect(result).toBeInstanceOf(StreamableFile);
  });

  it("clamps export limit to 100k", () => {
    const svc = makeService();
    const ctrl = new AuditController(svc as never);
    ctrl.exportCsv(undefined, undefined, "999999");
    expect(svc.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100_000 }),
    );
  });
});
