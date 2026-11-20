import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoEnv } from "./demoEnv.mjs";

// A demo launches the real app outside the WebDriver harness. Without its own WebView2 folder it shares
// the installed app's browser storage (same app identifier), so its version, theme and layout settings
// leak into the user's real install — a 1.3.3 demo made an installed 1.3.2 show What's New again.

describe("demoEnv", () => {
  it("keeps the demo's database and WebView2 storage inside the demo folder", () => {
    const dir = path.join("C:", "repo", ".demo-data");
    const env = demoEnv(dir);
    expect(env.VAULTSPEND_DB_DIR).toBe(dir);
    expect(env.WEBVIEW2_USER_DATA_FOLDER).toBe(path.join(dir, "webview"));
  });

  it("passes the rest of the environment through", () => {
    expect(demoEnv("x").PATH ?? demoEnv("x").Path).toBe(process.env.PATH ?? process.env.Path);
  });
});
