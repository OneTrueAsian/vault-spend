// R1 composed: a desktop run takes exclusive access, refuses an executable that is not the one built from the current inputs,
// treats that executable as immutable while it runs, and reports (and invalidates) a run during which the source or the
// executable changed. These tests use a throwaway directory and a fake "executable"; no app is started.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeBuildKey, computeTestKey, recordArtifact } from "./buildIdentity.mjs";
import { AccessHeldError, acquireAccess } from "./exclusiveAccess.mjs";
import { GuardRefusal, beginGuardedRun } from "./runGuard.mjs";

const toolchain = { node: "v22.20.0", rustc: "rustc 1.98.0", cargo: "cargo 1.98.0" };
let dir, exe, record, lockDir, inputs;
const key = () => computeBuildKey({ files: inputs, toolchain, mode: "debug" });
const guard = (over = {}) => beginGuardedRun({ operation: "desktop-run", lockDir, exePath: exe, recordPath: record, collectInputs: () => ({ ...inputs }), toolchain, mode: "debug", ...over });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-guard-")); exe = path.join(dir, "app.exe"); record = path.join(dir, "artifact.json"); lockDir = path.join(dir, "lock");
  inputs = { "src/main.tsx": "a1", "src-tauri/src/lib.rs": "b2", "Cargo.lock": "c3" };
  fs.writeFileSync(exe, "binary-v1"); recordArtifact({ exePath: exe, recordPath: record, key: key() });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("starting a run", () => {
  it("accepts the executable built from the current inputs, holds exclusive access, and records the identity", async () => {
    const run = await guard();
    expect(run.artifact.status).toBe("fresh");
    expect(fs.existsSync(lockDir)).toBe(true);
    const verdict = await run.finish();
    expect(verdict.valid).toBe(true);
    expect(verdict.problems).toEqual([]);
    expect(verdict.identity).toMatchObject({ operation: "desktop-run", buildKey: key(), artifactStatus: "fresh", exeSha256: expect.stringMatching(/^[0-9A-F]{64}$/) });
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("refuses a stale executable (an input changed since it was built) before anything runs, and leaves no lock behind", async () => {
    inputs["src/main.tsx"] = "edited after the build";
    const err = await guard().then(() => null, e => e);
    expect(err).toBeInstanceOf(GuardRefusal);
    expect(err.status).toBe("stale");
    expect(err.message).toMatch(/rebuild|build/i);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("refuses an executable replaced after it was recorded", async () => {
    fs.writeFileSync(exe, "binary-v2");
    const err = await guard().then(() => null, e => e);
    expect(err).toBeInstanceOf(GuardRefusal); expect(err.status).toBe("changed");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("refuses a missing executable", async () => {
    fs.rmSync(exe);
    const err = await guard().then(() => null, e => e);
    expect(err).toBeInstanceOf(GuardRefusal); expect(err.status).toBe("missing");
  });
  it("an explicit allowance proceeds on a stale executable, and the identity says so", async () => {
    inputs["src/main.tsx"] = "edited after the build";
    const run = await guard({ allowStale: true });
    const verdict = await run.finish();
    expect(verdict.identity.artifactStatus).toBe("stale");
    expect(verdict.identity.staleAllowed).toBe(true);
  });
  it("an executable with no record is allowed but labelled unknown, never fresh", async () => {
    fs.rmSync(record);
    const run = await guard();
    expect(run.artifact.status).toBe("unknown");
    expect((await run.finish()).identity.artifactStatus).toBe("unknown");
  });
  it("is refused while another run or build holds access, and does not disturb that holder", async () => {
    const other = await acquireAccess({ dir: lockDir, operation: "tauri-build" });
    const err = await guard().then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError);
    expect(JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")).token).toBe(other.owner.token);
    other.release();
  });
  it("can wait for a build to finish instead of failing", async () => {
    const other = await acquireAccess({ dir: lockDir, operation: "tauri-build" });
    const waiting = guard({ wait: true, timeoutMs: 5000, pollMs: 20 });
    setTimeout(() => other.release(), 100);
    const run = await waiting;
    expect(run.artifact.status).toBe("fresh");
    await run.finish();
  });
});

describe("when build identity cannot be computed (no git, rustc or cargo available)", () => {
  it("still takes exclusive access and runs, labelled unknown with the reason, instead of crashing", async () => {
    const run = await guard({ collectInputs: () => { throw new Error("git is not available"); } });
    expect(run.artifact.status).toBe("unknown");
    expect(run.artifact.reason).toMatch(/identity.*unavailable.*git is not available/i);
    expect(fs.existsSync(lockDir)).toBe(true);
    const verdict = await run.finish();
    expect(verdict.valid).toBe(true);
    expect(verdict.identity).toMatchObject({ artifactStatus: "unknown", buildKey: null, exeSha256: expect.stringMatching(/^[0-9A-F]{64}$/) });
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("an incomplete toolchain is the same: unknown, not a crash", async () => {
    const run = await guard({ toolchain: { node: "v22", rustc: "", cargo: "" } });
    expect(run.artifact.status).toBe("unknown"); expect(run.artifact.reason).toMatch(/unavailable/i);
    await run.finish();
  });
  it("the executable is still treated as immutable: replacing it during the run invalidates the evidence", async () => {
    const run = await guard({ collectInputs: () => { throw new Error("no git"); } });
    fs.writeFileSync(exe, "binary-replaced");
    const verdict = await run.finish();
    expect(verdict.valid).toBe(false); expect(verdict.problems.map(p => p.kind)).toEqual(["executable-changed"]);
  });
  it("a missing executable is still refused", async () => {
    fs.rmSync(exe);
    const err = await guard({ collectInputs: () => { throw new Error("no git"); } }).then(() => null, e => e);
    expect(err).toBeInstanceOf(GuardRefusal); expect(err.status).toBe("missing");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("another holder is still respected", async () => {
    const other = await acquireAccess({ dir: lockDir, operation: "tauri-build" });
    const err = await guard({ collectInputs: () => { throw new Error("no git"); } }).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError);
    other.release();
  });
});

describe("during a run", () => {
  it("a source edit invalidates the evidence and names the file", async () => {
    const run = await guard();
    inputs["src/main.tsx"] = "edited mid-run"; inputs["src/added.ts"] = "n";
    const verdict = await run.finish();
    expect(verdict.valid).toBe(false);
    expect(verdict.problems).toEqual([expect.objectContaining({ kind: "source-changed", changed: ["src/main.tsx"], added: ["src/added.ts"], removed: [] })]);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("a deleted source file is reported too", async () => {
    const run = await guard();
    delete inputs["Cargo.lock"];
    expect((await run.finish()).problems[0]).toMatchObject({ kind: "source-changed", removed: ["Cargo.lock"] });
  });
  it("replacing the executable invalidates the evidence", async () => {
    const run = await guard();
    fs.writeFileSync(exe, "binary-v2-rebuilt-by-someone");
    const verdict = await run.finish();
    expect(verdict.valid).toBe(false);
    expect(verdict.problems.map(p => p.kind)).toContain("executable-changed");
  });
  it("edits to files that are not build inputs do not invalidate it", async () => {
    const run = await guard();
    inputs["README.md"] = "docs edited"; inputs["e2e/run-all.mjs"] = "runner edited";
    expect((await run.finish()).valid).toBe(true);
  });
  it("reports both problems when both happen", async () => {
    const run = await guard();
    inputs["src/main.tsx"] = "x"; fs.writeFileSync(exe, "binary-v3");
    expect((await run.finish()).problems.map(p => p.kind).sort()).toEqual(["executable-changed", "source-changed"]);
  });
  it("finishing twice, or aborting after finishing, is harmless and keeps the first verdict", async () => {
    const run = await guard();
    const first = await run.finish();
    expect(await run.finish()).toEqual(first);
    run.abort();
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("aborting releases access without producing a verdict that looks valid", async () => {
    const run = await guard();
    run.abort();
    expect(fs.existsSync(lockDir)).toBe(false);
    expect((await run.finish()).valid).toBe(false);
  });
});

describe("test and harness identity is separate from the application's (owner decision 20 Oct 2026)", () => {
  it("a test edit made before the run does not make the executable stale, and the result records the test key as well as the build key", async () => {
    inputs["src/askVault/useRetirementScenario.test.tsx"] = "edited after the build";
    inputs["e2e/lib/harness.mjs"] = "also edited";
    const run = await guard();
    expect(run.artifact.status).toBe("fresh");
    const verdict = await run.finish();
    expect(verdict.valid).toBe(true);
    expect(verdict.identity.buildKey).toBe(key());
    expect(verdict.identity.testKey).toBe(computeTestKey({ files: inputs }));
    expect(verdict.identity.testKey).toMatch(/^[0-9a-f]{64}$/);
  });
  it("a test file changed during the run invalidates it, names the file, and says the application was not touched", async () => {
    inputs["src/a.test.ts"] = "v1";
    const run = await guard();
    inputs["src/a.test.ts"] = "v2";
    const verdict = await run.finish();
    expect(verdict.valid).toBe(false);
    expect(verdict.problems).toEqual([{ kind: "tests-changed", added: [], removed: [], changed: ["src/a.test.ts"] }]);
    expect(verdict.identity.buildKey).toBe(key());
  });
  it("a test file added or removed during the run invalidates it too", async () => {
    inputs["src/b.test.ts"] = "v1";
    const run = await guard();
    delete inputs["src/b.test.ts"]; inputs["src/new.test.ts"] = "x";
    const verdict = await run.finish();
    expect(verdict.valid).toBe(false);
    expect(verdict.problems).toEqual([{ kind: "tests-changed", added: ["src/new.test.ts"], removed: ["src/b.test.ts"], changed: [] }]);
  });
  it("an application file changed during the run is still a source change, reported on its own", async () => {
    const run = await guard();
    inputs["src/main.tsx"] = "edited mid-run";
    const verdict = await run.finish();
    expect(verdict.valid).toBe(false);
    expect(verdict.problems.map(p => p.kind)).toEqual(["source-changed"]);
  });
});
