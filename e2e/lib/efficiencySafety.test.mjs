// Resumed efficiency review F1/F4/F5. Real planner/selector/lock APIs; no app or shared target lock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectAffected } from "./affected.mjs";
import { planVerification } from "./verifyPlan.mjs";
import { AccessHeldError, AccessTimeoutError, acquireAccess } from "./exclusiveAccess.mjs";

const map = JSON.parse(fs.readFileSync("e2e/affected-map.json", "utf8"));
const specs = ["smoke.mjs", "feature41_transaction_qa.mjs", "feature304_ask_vault_retirement_flow.mjs", "feature305_screens_default_light_960.mjs", "feature270_dashboard_order.mjs", "feature291_financial_snapshot_lifecycle.mjs"];
const native = ["cargo-fmt", "cargo-clippy", "cargo-test-core", "cargo-test-commands"];
const select = changes => selectAffected({ changes, specs, map, e2eDir: path.resolve("e2e") });
const plan = selection => planVerification({ mode: "fast", selection, allSpecs: specs });
const roots = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("F1: native checks are independent of broad desktop selection", () => {
  it.each(["core/src/store.rs", "src-tauri/src/lib.rs", "Cargo.toml", "Cargo.lock", "core/Cargo.toml", "src-tauri/build.rs", "rust-toolchain.toml", "some-new-native-module.rs"])("keeps native validation for %s", file => {
    const selection = select([{ status: "M", path: file }]);
    expect(selection.broad).toBe(true);
    expect(selection.nativeChecks).toEqual(expect.arrayContaining(native));
    const ids = plan(selection).steps.map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(["cargo-fmt", "cargo-clippy"]));
    if (selection.nativeChecks.includes("cargo-test-workspace")) {
      expect(ids.filter(id => id.startsWith("cargo-test"))).toEqual(["cargo-test-workspace"]);
    } else expect(ids).toEqual(expect.arrayContaining(native));
    expect(plan(selection).skipped.some(s => s.id === "cargo")).toBe(false);
  });
  it.each(["A", "D", "R"])("uses both paths of a %s change", status => {
    const selection = select([{ status, path: "src/new-helper.ts", oldPath: "core/src/retired.rs" }]);
    expect(plan(selection).steps.map(s => s.id)).toEqual(expect.arrayContaining(["cargo-fmt", "cargo-clippy", "cargo-test-workspace"]));
  });
  it("still validates changed native tests when no desktop spec is selected", () => {
    const selection = select([{ status: "M", path: "core/src/store/tests/accounts.rs" }]);
    expect(selection.specs).toEqual([]);
    expect(plan(selection).steps.map(s => s.id)).toEqual(expect.arrayContaining(native));
  });
  it("does not add native work for a frontend-only change", () => {
    const selection = select([{ status: "M", path: "src/AskVaultCard.tsx" }]);
    expect(selection.nativeChecks).toEqual([]);
    expect(plan(selection).steps.some(s => s.id.startsWith("cargo"))).toBe(false);
  });
  it("honours structured checks without depending on their human-readable explanations", () => {
    const selection = { ...select([]), nativeChecks: native, required: [] };
    expect(plan(selection).steps.map(s => s.id)).toEqual(expect.arrayContaining(native));
  });
});

describe("F4: heartbeat age cannot prove a live PID was reused", () => {
  function owned(over = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-efficiency-lock-")); roots.push(dir);
    const old = new Date(Date.now() - 3600000).toISOString();
    const owner = { operation: "compiler-still-running", pid: process.pid, token: "live-original", startedAt: old, heartbeatAt: old, ...over };
    fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify(owner));
    return { dir, owner };
  }
  it.each(["old heartbeat", "missing heartbeat", "invalid heartbeat"])("refuses takeover of a live holder with %s", async kind => {
    const { dir, owner } = owned(kind === "missing heartbeat" ? { heartbeatAt: undefined } : kind === "invalid heartbeat" ? { heartbeatAt: "invalid" } : {});
    const outcome = await acquireAccess({ dir, operation: "desktop", isAlive: () => true, staleMs: 1 }).then(lock => { lock.release(); return "acquired"; }, error => error);
    expect(outcome).toBeInstanceOf(AccessHeldError);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8")).token).toBe(owner.token);
  });
  it("a waiting caller times out without removing a suspended holder's lock", async () => {
    const { dir, owner } = owned();
    const outcome = await acquireAccess({ dir, operation: "desktop", isAlive: () => true, staleMs: 1, wait: true, timeoutMs: 40, pollMs: 5 }).then(lock => { lock.release(); return "acquired"; }, error => error);
    expect(outcome).toBeInstanceOf(AccessTimeoutError);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8")).token).toBe(owner.token);
  });
  it("dead-holder recovery still works without guessing from a timestamp", async () => {
    const { dir } = owned({ heartbeatAt: new Date().toISOString() });
    const lock = await acquireAccess({ dir, operation: "desktop", isAlive: () => false });
    try { expect(lock.recovered.token).toBe("live-original"); } finally { lock.release(); }
  });
});

describe("F5: full native verification is not only command-filtered app tests", () => {
  it("uses one full workspace test command, with no lib/commands filter or duplicate filtered runs", () => {
    const full = planVerification({ mode: "full", selection: select([]), allSpecs: specs });
    const tests = full.steps.filter(s => s.id.startsWith("cargo-test"));
    expect(tests).toHaveLength(1);
    expect(tests[0].command).toEqual(["node", "e2e/with-access.mjs", "cargo-test", "--", "cargo", "test", "--workspace", "--", "--test-threads=1"]);
  });
});
