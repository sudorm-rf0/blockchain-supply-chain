import tseslint from "typescript-eslint";
import js from "@eslint/js";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/target/**", "**/node_modules/**", "**/prisma/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
