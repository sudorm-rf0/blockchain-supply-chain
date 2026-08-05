import tseslint from "typescript-eslint";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Next 15 的 eslint-config-next 仍是 legacy (eslintrc) 格式，
// 用 FlatCompat 桥接到 ESLint 9 flat config。
const compat = new FlatCompat({ baseDirectory: __dirname });

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/target/**",
      "**/node_modules/**",
      "**/playwright.config.ts",
      "**/next.config.mjs",
      "**/postcss.config.mjs",
      "**/tailwind.config.ts",
      "**/vitest.config.ts",
      "**/service-worker/**",
    ],
  },
  js.configs.recommended,
  ...compat.extends("next/core-web-vitals"),
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
