import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose — that one is tailored for Tauri
// dev/build (fixed port, ignores src-tauri, etc.) and shouldn't also carry
// test-runner concerns. Pure-logic modules (no DOM, no Tauri APIs) are the
// intended targets here — anything that touches the real app needs the
// e2e/ WebDriver suite instead, since there's no DOM/Tauri IPC in this
// environment.
//
// `.tsx` is included alongside `.ts` for one narrow exception: a component
// can have dev-only bugs (React `<StrictMode>`, main.tsx, double-invokes
// every effect in development to surface non-idempotent ones) that the e2e
// suite structurally cannot catch, since it always drives the *production*
// build (`tauri build`), where StrictMode never double-invokes. Such a
// file opts into a DOM via its own `// @vitest-environment jsdom` pragma
// (see Modal.test.tsx) — the default `environment: "node"` below is
// unchanged for everything else.
export default defineConfig({
  test: {
    environment: "node",
    // e2e/**/*.test.mjs: unit tests for the E2E harness's own logic, run against stand-in browser objects —
    // no app, no WebDriver.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/**/*.test.mjs"],
  },
});
