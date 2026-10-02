// Lints the page code (`npm run lint`). The React hooks rules are the ones the code's existing
// `eslint-disable-next-line react-hooks/...` comments refer to; before this file they were not
// checked at all (2026-10-02 QA, M8).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "target", "core", "node_modules", "e2e", "tools", "**/*.test.ts", "**/*.test.tsx"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
);
