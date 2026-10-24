import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";

describe("M5 fixture hook release elimination", () => {
  const bundle = (debug: boolean) => buildSync({ entryPoints: ["src/tauriInvoke.ts"], bundle: true, write: false, platform: "browser", format: "esm", minify: true,
    define: { "import.meta.env.TAURI_ENV_DEBUG": JSON.stringify(String(debug)) } }).outputFiles[0].text;
  it("keeps the fixture seam in debug output and removes both exposure and native fixture check from release output", () => {
    const debug = bundle(true), release = bundle(false);
    expect(debug).toContain("__vaultspendDebug"); expect(debug).toContain("debug_retirement_fixture_allowed");
    expect(release).not.toContain("__vaultspendDebug"); expect(release).not.toContain("debug_retirement_fixture_allowed");
    expect(release).toContain("set_investment_plan"); // normal production writes and notifications remain present
  });
});
