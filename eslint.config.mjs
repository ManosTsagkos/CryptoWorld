import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Market icons come from runtime data providers and are not known at build time.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "dist/**",
    "types/**",
    "next-env.d.ts",
    ".wrangler/**",
    ".local/**",
    ".local-assets/**",
    "outputs/**",
    "work/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
