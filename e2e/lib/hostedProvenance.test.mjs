import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeBuildKey } from "./buildIdentity.mjs";
import { buildArtifact } from "./buildApp.mjs";
import { beginGuardedRun, GuardRefusal } from "./runGuard.mjs";

let workflow;
const step = name => {
  const marker = `      - name: ${name}\n`;
  expect(workflow.split(marker)).toHaveLength(2);
  return workflow.split(marker)[1].split("      - name:")[0];
};
const profile = source => source.match(/^\s+CARGO_PROFILE_DEV_OPT_LEVEL:\s*['"]?([^'"\s]+)/m)?.[1];
const buildStep = () => step("Build current desktop test app");
const gateStep = gate => step(gate === "smoke" ? "Desktop WebDriver smoke preflight" : "Full desktop E2E release gate");
const toolchain = { node: "fixture-node", rustc: "fixture-rust", cargo: "fixture-cargo" };
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-hosted-provenance-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
// The workflow's real declared environment drives the real builder/guard. Only compilation is a fixture stand-in.
const inputs = setting => ({ "src/main.tsx": "same-app", "@build/environment": JSON.stringify(setting === undefined ? {} : { CARGO_PROFILE_DEV_OPT_LEVEL: setting }) });
const options = setting => ({ operation: "hosted-fixture", lockDir: path.join(root, "lock"), exePath: path.join(root, "fixture.exe"), recordPath: path.join(root, "artifact.json"), collectInputs: () => inputs(setting), toolchain, mode: "debug" });
const build = setting => buildArtifact({ ...options(setting), runBuild: async () => fs.writeFileSync(path.join(root, "fixture.exe"), "fixture compiler output") });

describe.each(["release-windows.yml", "prepare-signed-installers.yml"])("hosted provenance compatibility: %s", file => {
  beforeEach(() => { workflow = fs.readFileSync(`.github/workflows/${file}`, "utf8").replaceAll("\r\n", "\n"); });
  it("records the debug artifact before either medium-integrity gate", () => {
    expect(buildStep()).toMatch(/^\s+run: npm run build:app\s*$/m);
    expect(workflow.indexOf("      - name: Build current desktop test app")).toBeLessThan(workflow.indexOf("      - name: Desktop WebDriver smoke preflight"));
    expect(workflow.indexOf("      - name: Desktop WebDriver smoke preflight")).toBeLessThan(workflow.indexOf("      - name: Full desktop E2E release gate"));
    expect(fs.readFileSync("e2e/build-app.mjs", "utf8")).toContain('["tauri", "build", "--debug", "--no-bundle"]');
    expect(profile(buildStep())).toBe("1");
  });
  it.each(["smoke", "full"])("preserves compiled profile identity at the %s gate", async gate => {
    const buildProfile = profile(buildStep()), gateProfile = profile(gateStep(gate));
    expect(gateProfile).toBe(buildProfile);
    await build(buildProfile);
    const guard = await beginGuardedRun(options(gateProfile));
    expect(guard.artifact.status).toBe("fresh");
    const result = await guard.finish();
    expect(result.valid).toBe(true);
    expect(result.identity.buildKey).toBe(computeBuildKey({ files: inputs(buildProfile), toolchain, mode: "debug" }));
    expect(fs.existsSync(path.join(root, "lock"))).toBe(false);
  });
  it("still refuses a gate with a genuinely different compiled profile", async () => {
    await build(profile(buildStep()));
    await expect(beginGuardedRun(options("2"))).rejects.toBeInstanceOf(GuardRefusal);
    expect(fs.existsSync(path.join(root, "lock"))).toBe(false);
  });
  it("does not turn a missing hosted record into accepted evidence", async () => {
    await build(profile(buildStep())); fs.unlinkSync(path.join(root, "artifact.json"));
    const guard = await beginGuardedRun(options(profile(buildStep())));
    const result = await guard.finish();
    expect(result.valid).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({ kind: "untrusted-artifact", status: "unknown" }));
  });
  it("retains medium integrity, serial full coverage and the hosted timeout", () => {
    for (const gate of ["smoke", "full"]) expect(gateStep(gate)).toContain("--integrity Medium --direct");
    expect(gateStep("full")).toContain("VAULTSPEND_E2E_SPEC_TIMEOUT_MS: '180000'");
    expect(fs.readFileSync("tools/run-hosted-desktop-tests.ps1", "utf8")).toContain("@('run', 'e2e', '--', '--concurrency=1', '--retry-failed')");
  });
  it("retries a failed full-gate spec once, alone, and only in the full gate", () => {
    const script = fs.readFileSync("tools/run-hosted-desktop-tests.ps1", "utf8");
    expect(script.match(/--retry-failed/g)).toHaveLength(1);
    expect(script.slice(script.indexOf("if ($Gate -eq 'smoke')"), script.indexOf("} else {"))).not.toContain("--retry-failed");
  });
});
