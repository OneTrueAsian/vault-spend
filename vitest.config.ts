import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose — that one is tailored for Tauri
// dev/build (fixed port, ignores src-tauri, etc.) and shouldn't also carry
// test-runner concerns. Node tests cover logic and mocked API contracts;
// component tests opt into jsdom with their own environment pragma.
// Those tests cover rendering, events and React lifecycle behavior,
// including StrictMode's development effect checks. They complement
// e2e/ WebDriver tests of the compiled Tauri app, real IPC and geometry.
// jsdom does not establish native layout or real backend behavior, and
// compiled-app tests do not exercise development-only StrictMode effects.
export default defineConfig({
  test: {
    environment: "node",
    // e2e/**/*.test.mjs: unit tests for the E2E harness's own logic, run against stand-in browser objects —
    // no app, no WebDriver.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/**/*.test.mjs"],
  },
});
