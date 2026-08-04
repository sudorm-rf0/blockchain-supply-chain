import { Injectable, Logger } from "@nestjs/common";
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";

const INSTREAM_CHUNK = 64 * 1024;
const SCAN_TIMEOUT_MS = 20_000;

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  async scan(filePath: string): Promise<{ clean: boolean }> {
    const clamHost = process.env.CLAMAV_HOST;
    if (clamHost) {
      return this.scanClamd(
        filePath,
        clamHost,
        Number(process.env.CLAMAV_PORT ?? 3310),
      );
    }
    const url = process.env.SCAN_URL;
    if (!url) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CLAMAV_HOST or SCAN_URL must be set in production");
      }
      this.logger.warn("virus scan disabled: set CLAMAV_HOST or SCAN_URL");
      return { clean: false };
    }
    return this.scanHttp(filePath, url);
  }

  private scanClamd(
    filePath: string,
    host: string,
    port: number,
  ): Promise<{ clean: boolean }> {
    return new Promise((resolve) => {
      const socket = createConnection({ host, port });
      let settled = false;
      let response = "";
      const finish = (clean: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({ clean });
      };
      const timer = setTimeout(() => {
        this.logger.error(`clamd scan timeout: ${host}:${port}`);
        finish(false);
      }, SCAN_TIMEOUT_MS);

      socket.on("connect", () => {
        socket.write(Buffer.from("zINSTREAM\0"));
        const data = readFileSync(filePath);
        for (let offset = 0; offset < data.length; offset += INSTREAM_CHUNK) {
          const slice = data.subarray(offset, offset + INSTREAM_CHUNK);
          const header = Buffer.alloc(4);
          header.writeUInt32LE(slice.length, 0);
          socket.write(Buffer.concat([header, slice]));
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8");
      });
      socket.on("error", (error) => {
        this.logger.error(`clamd scan error: ${String(error)}`);
        finish(false);
      });
      socket.on("end", () => finish(!/FOUND/.test(response)));
      socket.on("close", () => finish(!/FOUND/.test(response)));
    });
  }

  private async scanHttp(
    filePath: string,
    url: string,
  ): Promise<{ clean: boolean }> {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(filePath)]), "upload");
    try {
      const response = await fetch(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return { clean: false };
      const body = (await response.json()) as { clean?: boolean };
      return { clean: body.clean !== false };
    } catch (error) {
      this.logger.error(`scan service unreachable: ${String(error)}`);
      return { clean: false };
    }
  }
}
