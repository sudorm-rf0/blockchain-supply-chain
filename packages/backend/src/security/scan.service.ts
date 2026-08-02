import { Injectable, Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  async scan(filePath: string): Promise<{ clean: boolean }> {
    const url = process.env.SCAN_URL;
    if (!url) return { clean: true };

    const form = new FormData();
    form.append(
      "file",
      new Blob([readFileSync(filePath)]),
      "upload",
    );
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
