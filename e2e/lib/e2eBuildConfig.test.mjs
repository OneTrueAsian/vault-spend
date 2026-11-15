import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isBuildInput } from "./buildIdentity.mjs";

// VS-32: since about 2026-11-11 WebView2 on the dev machine ignores WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, the
// variable msedgedriver uses to turn on the WebView's debugging port, so no desktop spec could start a session
// ("DevToolsActivePort file doesn't exist"). The E2E test build now asks for the port itself through the app's own
// window config, merged in by `npm run build:app` only. Release builds do not use this overlay.

const read = (file) => JSON.parse(fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
const base = read("src-tauri/tauri.conf.json");
const overlay = read("src-tauri/tauri.e2e.conf.json");

describe("E2E test-build config overlay", () => {
  it("is passed to the debug build by npm run build:app", () => {
    expect(fs.readFileSync(new URL("../build-app.mjs", import.meta.url), "utf8")).toContain('["tauri", "build", "--debug", "--no-bundle", "--config", "src-tauri/tauri.e2e.conf.json"]');
  });

  it("keeps every window setting from tauri.conf.json, since a config overlay replaces the whole windows list", () => {
    expect(overlay.app.windows).toHaveLength(base.app.windows.length);
    overlay.app.windows.forEach((win, i) => {
      const { additionalBrowserArgs, ...rest } = win;
      expect(additionalBrowserArgs).toBeTypeOf("string");
      expect(rest).toEqual(base.app.windows[i]);
    });
  });

  it("turns on the debugging port and keeps the WebView arguments Tauri uses by default", () => {
    const args = overlay.app.windows[0].additionalBrowserArgs.split(" ");
    expect(args).toContain("--remote-debugging-port=0");
    expect(args).toContain("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
  });

  it("changes nothing but the windows list", () => {
    expect(Object.keys(overlay)).toEqual(["app"]);
    expect(Object.keys(overlay.app)).toEqual(["windows"]);
  });

  it("counts as a build input, so a test build made before or without it is never reused", () => {
    expect(isBuildInput("src-tauri/tauri.e2e.conf.json")).toBe(true);
  });
});
