import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/app/**/__tests__/**",
        "src/components/__tests__/**",
        "src/lib/__tests__/**",
        "src/components/ui/**",
        "src/app/**/error.tsx",
        "src/app/**/global-error.tsx",
        "src/app/**/layout.tsx",
        "src/app/manifest.ts",
        "src/app/globals.css",
        "src/middleware.ts",
      ],
      // 防回归门槛：低于当前基线（~19% stmts/lines、~22% funcs、~59% branch）
      thresholds: {
        statements: 15,
        lines: 15,
        functions: 15,
        branches: 40,
      },
    },
  },
});
