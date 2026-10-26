import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifySpecs, createApprovalContext, runSchedule } from "./scheduler.mjs";
import { acquireAccess, AccessHeldError } from "./exclusiveAccess.mjs";
import { selectAffected } from "./affected.mjs";
import { planVerification } from "./verifyPlan.mjs";
import { spawnSync } from "node:child_process";
import { buildArtifact } from "./buildApp.mjs";
import { beginGuardedRun } from "./runGuard.mjs";

const dirs = [];
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));
const binding = { buildKey: "app", exeSha256: "exe", sourceKey: "sources" };
const receipt = id => ({ id, runId: id, valid: true, concurrency: 6, binding, specs: ["a.mjs", "b.mjs"], results: [{ name: "a.mjs", code: 0 }, { name: "b.mjs", code: 0 }] });
const config = () => ({ parallelSafe: ["a.mjs", "b.mjs"], exclusive: {}, approvals: { "a.mjs": { binding, receipts: ["one", "two"] }, "b.mjs": { binding, receipts: ["one", "two"] } } });
const context = () => ({ binding, receipts: { one: receipt("one"), two: receipt("two") } });

describe("dependency-bound scheduling approvals", () => {
  it("binds helper, fixture, application and classification changes, without a circular registry key", () => {
    const inputs = { "src/App.css": "one", "e2e/lib/helper.mjs": "one", "e2e/fixtures/ledger.sql": "one", "e2e/spec-classification.json": "one", "e2e/parallel-approvals.json": "one" };
    const current = createApprovalContext({ inputs, identity: binding });
    for (const file of Object.keys(inputs).filter(p => !p.endsWith("parallel-approvals.json"))) {
      expect(createApprovalContext({ inputs: { ...inputs, [file]: "two" }, identity: binding }).binding.sourceKey).not.toBe(current.binding.sourceKey);
    }
    expect(createApprovalContext({ inputs: { ...inputs, "e2e/parallel-approvals.json": "two" }, identity: binding }).binding.sourceKey).toBe(current.binding.sourceKey);
    expect(createApprovalContext({ inputs: { ...inputs, "src/unrelated.test.tsx": "new unit test" }, identity: binding }).binding.sourceKey).toBe(current.binding.sourceKey);
  });
  it("does not count two names for the same physical receipt as two repetitions", () => {
    const ctx = context(); ctx.receipts.one.receiptSha256 = "identical"; ctx.receipts.two.receiptSha256 = "identical";
    expect(classifySpecs(["a.mjs"], config(), ctx).parallel).toEqual([]);
  });
  it("does not count cosmetic rewrites of one run as separate repetitions", () => {
    const ctx = context(); ctx.receipts.one.runId = "same-run"; ctx.receipts.two.runId = "same-run";
    expect(classifySpecs(["a.mjs"], config(), ctx).parallel).toEqual([]);
  });
  it("does not treat legacy name-only lists as source-bound approvals", () => {
    expect(classifySpecs(["a.mjs"], { parallelSafe: ["a.mjs"] }, context()).parallel).toEqual([]);
  });
  it("accepts two separate passing concurrent receipts for the exact binding", () => {
    expect(classifySpecs(["a.mjs", "b.mjs"], config(), context()).parallel).toEqual(["a.mjs", "b.mjs"]);
  });
  it.each(["buildKey", "exeSha256", "sourceKey"])("invalidates an approval after %s changes", key => {
    const ctx = context(); ctx.binding = { ...binding, [key]: "changed" };
    expect(classifySpecs(["a.mjs"], config(), ctx).parallel).toEqual([]);
  });
  it.each(["serial", "failed", "invalid", "missing", "duplicate", "not-executed", "null-result", "nonstring-name"])("refuses %s evidence", defect => {
    const c = config(), ctx = context();
    if (defect === "serial") ctx.receipts.two.concurrency = 1;
    if (defect === "failed") ctx.receipts.two.results[0].code = 1;
    if (defect === "invalid") ctx.receipts.two.valid = false;
    if (defect === "missing") delete ctx.receipts.two;
    if (defect === "duplicate") c.approvals["a.mjs"].receipts = ["one", "one"];
    if (defect === "not-executed") ctx.receipts.two.results = [];
    if (defect === "null-result") ctx.receipts.two.results = [null, null];
    if (defect === "nonstring-name") { ctx.receipts.two.specs = ["a.mjs", null]; ctx.receipts.two.results[1].name = null; }
    expect(classifySpecs(["a.mjs"], c, ctx).parallel).toEqual([]);
  });
  it("never overrides an exclusive conflict", () => {
    const c = config(); c.exclusive["a.mjs"] = "foreground";
    expect(classifySpecs(["a.mjs"], c, context()).parallel).toEqual([]);
  });
  it("does not combine individually proved specs from never-co-tested pools", () => {
    const c = config(), ctx = context();
    c.approvals["b.mjs"].receipts = ["three", "four"];
    for (const id of ["one", "two"]) {
      ctx.receipts[id].specs = ["a.mjs", "c.mjs"];
      ctx.receipts[id].results = ctx.receipts[id].specs.map(name => ({ name, code: 0 }));
    }
    for (const id of ["three", "four"]) ctx.receipts[id] = { ...receipt(id), specs: ["b.mjs", "d.mjs"], results: ["b.mjs", "d.mjs"].map(name => ({ name, code: 0 })) };
    expect(classifySpecs(["a.mjs", "b.mjs"], c, ctx).parallel).toEqual([]);
  });
  it("does not promote concurrency above the repeated evidence", async () => {
    let active = 0, peak = 0;
    await runSchedule({ specs: ["a.mjs", "b.mjs"], classification: config(), approvalContext: context(), concurrency: 8,
      run: async name => { peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 2)); active--; return { name, code: 0 }; } });
    expect(peak).toBe(1);
  });
  it("drains approved work before invalidated or conflicting work starts", async () => {
    const c = config(); c.approvals["b.mjs"].binding = { ...binding, sourceKey: "old" };
    let active = 0; const peaks = [];
    const results = await runSchedule({ specs: ["a.mjs", "b.mjs"], classification: c, approvalContext: context(), concurrency: 6,
      run: async name => { active++; peaks.push([name, active]); await new Promise(r => setTimeout(r, 2)); active--; return { name, code: 0 }; } });
    expect(peaks).toEqual([["a.mjs", 1], ["b.mjs", 1]]);
    expect(results).toHaveLength(2);
  });
});

describe("unexpected owner exit is not evidence that protected descendants stopped", () => {
  it("leaves reconciliation access held when a real owned child outlives its parent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-surviving-child-")); dirs.push(root);
    const dir = path.join(root, "access"), marker = path.join(root, "child.json");
    const module = new URL("./exclusiveAccess.mjs", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from 'node:fs'; import {spawn} from 'node:child_process'; import {acquireAccess} from ${JSON.stringify(module)}; await acquireAccess({dir:${JSON.stringify(dir)},operation:'owned child',crashProtected:true}); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:c.pid}));c.unref();process.exit(7);`], { encoding: "utf8" });
    const child = JSON.parse(fs.readFileSync(marker));
    try {
      expect(result.status, result.stderr).toBe(7);
      expect(() => process.kill(child.pid, 0)).not.toThrow();
      await expect(acquireAccess({ dir, operation: "new" })).rejects.toBeInstanceOf(AccessHeldError);
    } finally { try { process.kill(child.pid); } catch { /* exact owned fixture already exited */ } }
  });
  it("does not erase a protected lock from the process exit hook", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-exiting-owner-")); dirs.push(root);
    const dir = path.join(root, "access");
    const module = new URL("./exclusiveAccess.mjs", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { acquireAccess } from ${JSON.stringify(module)}; await acquireAccess({dir:${JSON.stringify(dir)},operation:'owned child may survive',crashProtected:true}); process.exit(7);`], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(7);
    expect(fs.existsSync(path.join(dir, "owner.json"))).toBe(true);
  });
  it("wires crash protection into the real build and desktop guard", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-wrapper-policy-")); dirs.push(root);
    const dir = path.join(root, "access"), exe = path.join(root, "exe"), record = path.join(root, "record.json");
    const files = { "src/main.tsx": "source" }, toolchain = { node: "node", cargo: "cargo", rustc: "rustc" };
    const options = { lockDir: dir, exePath: exe, recordPath: record, collectInputs: () => files, toolchain, mode: "debug" };
    await buildArtifact({ ...options, runBuild: async () => {
      expect(JSON.parse(fs.readFileSync(path.join(dir, "owner.json"))).crashProtected).toBe(true);
      fs.writeFileSync(exe, "fixture");
    } });
    const guard = await beginGuardedRun({ ...options, operation: "desktop" });
    try { expect(JSON.parse(fs.readFileSync(path.join(dir, "owner.json"))).crashProtected).toBe(true); }
    finally { await guard.finish(); }
  });
  it("refuses a dead crash-protected holder until descendant reconciliation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-orphan-lock-")); dirs.push(dir);
    fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ token: "previous", pid: 123, operation: "cargo", crashProtected: true }));
    await expect(acquireAccess({ dir, operation: "new", isAlive: () => false })).rejects.toBeInstanceOf(AccessHeldError);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "owner.json"))).token).toBe("previous");
  });
  it("records the fail-closed policy and still permits explicit successful release", async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vs-crash-policy-")), "access"); dirs.push(path.dirname(dir));
    const held = await acquireAccess({ dir, operation: "protected", crashProtected: true });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "owner.json"))).crashProtected).toBe(true);
    held.release(); expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("FAST validation covers non-command native targets", () => {
  it.each(["core/src/store.rs", "core/src/new-module.rs", "src-tauri/src/mobile_https.rs", "src-tauri/src/lib.rs", "src-tauri/tests/new.rs", "Cargo.toml", "unknown.rs"])("does not silently filter %s to commands", file => {
    const selection = selectAffected({ changes: [{ status: "M", path: file }], specs: ["smoke.mjs"], map: { broad: [], noDesktop: [], areas: [] }, e2eDir: path.resolve("e2e") });
    const plan = planVerification({ mode: "fast", selection, allSpecs: ["smoke.mjs"] });
    const native = plan.steps.filter(s => s.id.startsWith("cargo-test"));
    expect(native).toHaveLength(1);
    expect(native[0].command).toEqual(expect.arrayContaining(["--workspace"]));
    expect(native[0].command).not.toContain("commands::");
    expect(plan.steps.find(s => s.id === "cargo-clippy").command).toEqual(expect.arrayContaining(["--workspace", "--all-targets"]));
  });
  it("honours the old path of renamed native source", () => {
    const selection = selectAffected({ changes: [{ status: "R", oldPath: "src-tauri/src/system_session.rs", path: "src/helper.ts" }], specs: [], map: { broad: [], noDesktop: [], areas: [] }, e2eDir: path.resolve("e2e") });
    expect(planVerification({ mode: "fast", selection, allSpecs: [] }).steps.some(s => s.id === "cargo-test-workspace")).toBe(true);
  });
});
