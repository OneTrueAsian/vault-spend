// R1: "npm run build:app" — build the Tauri app under exclusive access, reuse an executable only when its complete inputs match, and
// record what an executable was built from only when nothing changed while it was being built. The compiler itself is replaced by
// a stand-in here; the real build runs through the same function.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeBuildKey, recordArtifact, verifyArtifact } from "./buildIdentity.mjs";
import { AccessHeldError, acquireAccess } from "./exclusiveAccess.mjs";
import { buildArtifact } from "./buildApp.mjs";

const toolchain = { node: "v22.20.0", rustc: "rustc 1.98.0", cargo: "cargo 1.98.0" };
let dir, exe, record, lockDir, inputs, builds;
const options = (over = {}) => ({
  lockDir, exePath: exe, recordPath: record, collectInputs: () => ({ ...inputs }), toolchain, mode: "debug", pollMs: 20, timeoutMs: 2000,
  runBuild: async () => { builds++; fs.writeFileSync(exe, `binary-built-${builds}`); }, ...over,
});
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-build-")); exe = path.join(dir, "app.exe"); record = path.join(dir, "artifact.json"); lockDir = path.join(dir, "lock"); inputs = { "src/main.tsx": "a1", "Cargo.lock": "c3" }; builds = 0; });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const currentKey = () => computeBuildKey({ files: inputs, toolchain, mode: "debug" });

describe("building", () => {
  it("builds when there is no executable, records what it was built from, and releases access", async () => {
    const result = await buildArtifact(options());
    expect(result.action).toBe("built"); expect(builds).toBe(1);
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: currentKey() }).status).toBe("fresh");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("reuses the executable, without compiling, when every input matches", async () => {
    await buildArtifact(options());
    const again = await buildArtifact(options());
    expect(again.action).toBe("reused"); expect(builds).toBe(1);
    expect(again.artifact.status).toBe("fresh");
  });
  it.each([["a source edit", i => { i["src/main.tsx"] = "edited"; }], ["a new untracked source file", i => { i["src/new.ts"] = "n"; }], ["a deleted lockfile", i => { delete i["Cargo.lock"]; }]])(
    "rebuilds after %s", async (_name, change) => {
      await buildArtifact(options()); change(inputs);
      expect((await buildArtifact(options())).action).toBe("built"); expect(builds).toBe(2);
    });
  it("rebuilds when the toolchain or the mode differs from what was recorded", async () => {
    await buildArtifact(options());
    expect((await buildArtifact(options({ toolchain: { ...toolchain, rustc: "rustc 1.99.0" } }))).action).toBe("built");
    expect((await buildArtifact(options({ toolchain: { ...toolchain, rustc: "rustc 1.99.0" }, mode: "release" }))).action).toBe("built");
    expect(builds).toBe(3);
  });
  it("rebuilds an executable that has no record, or that was replaced behind the record", async () => {
    fs.writeFileSync(exe, "binary-from-elsewhere");
    expect((await buildArtifact(options())).action).toBe("built");
    fs.writeFileSync(exe, "binary-replaced");
    expect((await buildArtifact(options())).action).toBe("built");
    expect(builds).toBe(2);
  });
  it("--force rebuilds even when every input matches", async () => {
    await buildArtifact(options());
    expect((await buildArtifact(options({ force: true }))).action).toBe("built");
  });
});

describe("failure handling", () => {
  it("a failed build is reported, leaves no record that could pass for fresh, and releases access", async () => {
    await buildArtifact(options()); inputs["src/main.tsx"] = "edited";
    await expect(buildArtifact(options({ runBuild: async () => { throw new Error("compile error"); } }))).rejects.toThrow("compile error");
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: currentKey() }).status).toBe("unknown");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("source that changes while building is not recorded as built from the starting inputs", async () => {
    const err = await buildArtifact(options({ runBuild: async () => { fs.writeFileSync(exe, "binary"); inputs["src/main.tsx"] = "edited during the build"; } })).then(() => null, e => e);
    expect(err?.message).toMatch(/changed (while|during) .*build/i);
    expect(err.message).toMatch(/src\/main\.tsx/);
    expect(verifyArtifact({ exePath: exe, recordPath: record, currentKey: currentKey() }).status).toBe("unknown");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("a build that produces no executable is a failure, not a recorded artifact", async () => {
    const err = await buildArtifact(options({ runBuild: async () => {} })).then(() => null, e => e);
    expect(err).toBeInstanceOf(Error);
    expect(fs.existsSync(record)).toBe(false);
  });
});

describe("exclusive access", () => {
  it("waits for a desktop run to finish before building, then builds", async () => {
    const run = await acquireAccess({ dir: lockDir, operation: "desktop-run" });
    setTimeout(() => run.release(), 100);
    expect((await buildArtifact(options())).action).toBe("built");
  });
  it("does not build while the holder never lets go: it reports who holds access and compiles nothing", async () => {
    const run = await acquireAccess({ dir: lockDir, operation: "desktop-run" });
    const err = await buildArtifact(options({ timeoutMs: 100 })).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError); expect(err.owner.operation).toBe("desktop-run");
    expect(builds).toBe(0);
    run.release();
  });
  it("even deciding to reuse takes access, so the answer is consistent with a build or run in progress", async () => {
    await buildArtifact(options());
    const run = await acquireAccess({ dir: lockDir, operation: "desktop-run" });
    const err = await buildArtifact(options({ timeoutMs: 80 })).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError);
    run.release();
  });
});

describe("records written by hand", () => {
  it("a record from a different key is never treated as fresh", async () => {
    fs.writeFileSync(exe, "binary"); recordArtifact({ exePath: exe, recordPath: record, key: "0".repeat(64) });
    expect((await buildArtifact(options())).action).toBe("built");
  });
});
