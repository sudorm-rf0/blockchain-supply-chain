import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command:
      process.env.E2E_SERVER_MODE === "production"
        ? `FRONTEND_PORT=${process.env.E2E_FRONTEND_PORT ?? "3100"} pnpm start`
        : `FRONTEND_PORT=${process.env.E2E_FRONTEND_PORT ?? "3100"} pnpm dev`,
    url: `http://localhost:${process.env.E2E_FRONTEND_PORT ?? "3100"}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
