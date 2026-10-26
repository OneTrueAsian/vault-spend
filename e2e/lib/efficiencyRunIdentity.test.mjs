import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeBuildKey, recordArtifact } from "./buildIdentity.mjs";
import { beginGuardedRun } from "./runGuard.mjs";

const toolchain = { node: "fixture-node", rustc: "fixture-rust", cargo: "fixture-cargo" };
let dir, inputs, exe, record;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-efficiency-identity-"));
  inputs = { "src/main.tsx": "unchanged-app" }; exe = path.join(dir, "app.exe"); record = path.join(dir, "artifact.json");
  fs.writeFileSync(exe, "fixture-binary"); recordArtifact({ exePath: exe, recordPath: record, key: computeBuildKey({ files: inputs, toolchain, mode: "debug" }) });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const start = () => beginGuardedRun({ operation: "fixture-desktop", lockDir: path.join(dir, "lock"), exePath: exe, recordPath: record, collectInputs: () => ({ ...inputs }), toolchain, mode: "debug" });

describe("F3: validation inputs are not application build inputs", () => {
  it.each(["e2e/run-all.mjs", "e2e/harness.mjs", "e2e/feature500_new.mjs", "e2e/lib/new-helper.mjs", "e2e/lib/new-fixture.json", "e2e/spec-classification.json", "e2e/affected-map.json"])("invalidates a changed %s and retains before/after identities", async file => {
    inputs[file] = "before"; const run = await start(); inputs[file] = "after";
    const result = await run.finish();
    expect(result.valid).toBe(false);
    expect(result.problems).toContainEqual({ kind: "harness-changed", added: [], removed: [], changed: [file] });
    expect(result.identity.artifactStatus).toBe("fresh");
    expect(result.validationManifest.before[file]).toBe("before"); expect(result.validationManifest.after[file]).toBe("after");
    expect(fs.existsSync(path.join(dir, "lock"))).toBe(false);
  });
  it("names added and deleted helpers without requiring an application rebuild", async () => {
    inputs["e2e/lib/old.mjs"] = "before"; const run = await start(); delete inputs["e2e/lib/old.mjs"]; inputs["e2e/lib/new.mjs"] = "new";
    const result = await run.finish();
    expect(result.problems).toContainEqual({ kind: "harness-changed", changed: [], added: ["e2e/lib/new.mjs"], removed: ["e2e/lib/old.mjs"] });
  });
  it("documentation and timing-history changes do not invalidate executable or validation", async () => {
    const run = await start(); inputs["README.md"] = "new docs"; inputs["e2e/.e2e-durations.json"] = "timing only";
    const result = await run.finish(); expect(result.valid).toBe(true); expect(result.problems).toEqual([]);
  });
});

describe("F6: diagnostic execution is not acceptance without provenance", () => {
  it.each(["missing-record", "unavailable-collector", "stale-opt-in"])("does not accept %s even when diagnostic execution is allowed", async condition => {
    if (condition === "missing-record") fs.unlinkSync(record);
    if (condition === "stale-opt-in") inputs["src/main.tsx"] = "edited";
    const run = await beginGuardedRun({ operation: "diagnostic", lockDir: path.join(dir, "lock"), exePath: exe, recordPath: record,
      collectInputs: () => { if (condition === "unavailable-collector") throw new Error("cannot establish dependency closure"); return { ...inputs }; }, toolchain, mode: "debug", allowStale: true });
    const result = await run.finish();
    expect(result.valid).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({ kind: "untrusted-artifact", status: condition === "stale-opt-in" ? "stale" : "unknown" }));
    expect(fs.existsSync(path.join(dir, "lock"))).toBe(false);
  });
});
