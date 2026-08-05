import { ScanService } from "./scan.service";
import * as net from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("node:net", () => ({
  createConnection: jest.fn(),
}));

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

  it("allows unscanned uploads only when explicitly opted in", async () => {
    delete process.env.CLAMAV_HOST;
    delete process.env.SCAN_URL;
    process.env.ALLOW_UNSCANNED_UPLOADS = "true";
    const service = new ScanService();
    await expect(service.scan(filePath)).resolves.toEqual({ clean: true });
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

  it("sends INSTREAM chunk sizes in network byte order (big endian)", async () => {
    process.env.CLAMAV_HOST = "127.0.0.1";
    process.env.CLAMAV_PORT = "3310";
    const writes: Buffer[] = [];
    const fakeSocket: any = {
      write: (chunk: Buffer) => {
        writes.push(Buffer.from(chunk));
        return true;
      },
      on: (event: string, cb: () => void) => {
        if (event === "connect") setImmediate(cb);
        if (event === "close" || event === "end") setTimeout(cb, 5);
        return fakeSocket;
      },
      destroy: () => {},
    };
    (net.createConnection as unknown as jest.Mock).mockReturnValue(fakeSocket);
    const service = new ScanService();
    const file = join(dir, "chunk.bin");
    writeFileSync(file, Buffer.from("payload")); // 7 bytes
    await service.scan(file);

    // 数据块 write 为「4 字节长度头 + 数据」；头必须是 7 的大端表示
    // （00 00 00 07），与 clamd 的 INSTREAM 协议一致；小端（07 00 00 00）
    // 会被判超限。
    // 第 0 个 write 是 zINSTREAM\0 命令（10 字节），数据块在其后。
    const chunkWrite = writes.find((w) => w.length > 10);
    expect(chunkWrite?.subarray(0, 4)).toEqual(
      Buffer.from([0x00, 0x00, 0x00, 0x07]),
    );
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
