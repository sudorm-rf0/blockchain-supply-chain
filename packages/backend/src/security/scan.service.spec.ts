import { ScanService } from "./scan.service";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ScanService", () => {
  const originalEnv = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), "scan-spec-"));
  const filePath = join(dir, "sample.bin");

  beforeAll(() => {
    writeFileSync(filePath, Buffer.from("test payload"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns clean=false when virus scanning is not configured", async () => {
    delete process.env.CLAMAV_HOST;
    delete process.env.SCAN_URL;
    const service = new ScanService();
    await expect(service.scan(filePath)).resolves.toEqual({
      clean: false,
    });
  });

  it("fails closed when the HTTP scan service is unreachable", async () => {
    delete process.env.CLAMAV_HOST;
    process.env.SCAN_URL = "http://scan.example.com/check";
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new ScanService();
    await expect(service.scan(filePath)).resolves.toEqual({ clean: false });
  });

  it("uses the HTTP scan result when it is reachable", async () => {
    delete process.env.CLAMAV_HOST;
    process.env.SCAN_URL = "http://scan.example.com/check";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ clean: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new ScanService();
    await expect(service.scan(filePath)).resolves.toEqual({ clean: true });
  });
});
