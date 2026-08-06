import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import onlyWarn from "eslint-plugin-only-warn"
import turboPlugin from "eslint-plugin-turbo"
import tseslint from "typescript-eslint"

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    // Never lint vendored or generated trees. apps/web/public/ holds the
    // vendored TradingView charting library (~17k warnings by itself, served
    // verbatim as a static asset and never compiled); apps/indexer/generated/
    // and .ponder/ are `ponder codegen` output.
    ignores: [
      "dist/**",
      ".next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/public/**",
      "**/generated/**",
      "**/.ponder/**",
    ],
  },
]
