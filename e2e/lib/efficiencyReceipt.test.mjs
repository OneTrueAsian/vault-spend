// Real runner orchestration in a disposable repository: no app or shared target is used.
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectInputs, computeBuildKey, readToolchain, recordArtifact } from "./buildIdentity.mjs";
import { createApprovalContext } from "./scheduler.mjs";
import crypto from "node:crypto";

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-real-receipt-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.cpSync("e2e/lib", path.join(root, "e2e/lib"), { recursive: true });
  fs.copyFileSync("e2e/run-all.mjs", path.join(root, "e2e/run-all.mjs"));
  fs.mkdirSync(path.join(root, "target/debug"), { recursive: true });
  fs.writeFileSync(path.join(root, "target/debug/vaultspend.exe"), "not an executable; fixture specs do not launch it");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function run(source, trusted = true) {
  fs.writeFileSync(path.join(root, "e2e/smoke.mjs"), source);
  if (trusted) recordArtifact({ exePath: path.join(root, "target/debug/vaultspend.exe"), recordPath: path.join(root, "target/debug/vaultspend.artifact.json"), key: computeBuildKey({ files: collectInputs(root), toolchain: readToolchain(), mode: "debug" }) });
  const child = spawnSync(process.execPath, ["e2e/run-all.mjs", "--concurrency=1"], { cwd: root, encoding: "utf8", timeout: 20000 });
  return { child, receipt: JSON.parse(fs.readFileSync(path.join(root, "target/e2e-last-run.json"), "utf8")) };
}
describe("real CLI receipt and failure propagation", () => {
  it("uses hash-verified proof receipts, and demotes them after a reached helper changes", () => {
    const names = ["smoke.mjs", "feature1_fixture.mjs"];
    for (const name of names) fs.writeFileSync(path.join(root, "e2e", name), 'console.log("fixture");');
    fs.writeFileSync(path.join(root, "e2e/spec-classification.json"), JSON.stringify({ parallelSafe: names }));
    const inputs = collectInputs(root), buildKey = computeBuildKey({ files: inputs, toolchain: readToolchain(), mode: "debug" });
    const artifact = recordArtifact({ exePath: path.join(root, "target/debug/vaultspend.exe"), recordPath: path.join(root, "target/debug/vaultspend.artifact.json"), key: buildKey });
    const binding = createApprovalContext({ inputs, identity: { buildKey, exeSha256: artifact.exeSha256 } }).binding;
    const registry = { approvals: Object.fromEntries(names.map(n => [n, { binding, receipts: ["one", "two"] }])), receipts: {} };
    // Characterization fixture receipts, not real concurrent app evidence. Differing timestamps model separate runs.
    for (const id of ["one", "two"]) {
      const bytes = JSON.stringify({ id, identity: { buildKey, exeSha256: artifact.exeSha256, startedAt: id === "one" ? "2026-10-24T01:00:00Z" : "2026-10-24T02:00:00Z", finishedAt: id === "one" ? "2026-10-24T01:01:00Z" : "2026-10-24T02:01:00Z" }, valid: true, concurrency: 6, approvalBinding: binding, selected: names, executed: names.map(name => ({ name, code: 0 })) });
      fs.writeFileSync(path.join(root, id + ".json"), bytes);
      registry.receipts[id] = { path: id + ".json", sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    }
    fs.writeFileSync(path.join(root, "e2e/parallel-approvals.json"), JSON.stringify(registry));
    const invoke = () => spawnSync(process.execPath, ["e2e/run-all.mjs", "--concurrency=6"], { cwd: root, encoding: "utf8", timeout: 20000 });
    const first = invoke(); expect(first.status, first.stderr).toBe(0); expect(first.stdout).toContain("2 parallel-safe");
    fs.appendFileSync(path.join(root, "e2e/lib/specAudit.mjs"), "\n// reached helper changed\n");
    const changed = invoke(); expect(changed.status, changed.stderr).toBe(0); expect(changed.stdout).toContain("0 parallel-safe");
  });
  it("default scheduling does not silently bypass source-bound approvals", () => {
    const { child, receipt } = run('console.log("ordinary default");');
    expect(child.status, child.stderr).toBe(0);
    expect(receipt.schedule).toBe("classified");
  });
  it("unapproved pool execution is diagnostic rather than accepted parallel evidence", () => {
    fs.writeFileSync(path.join(root, "e2e/smoke.mjs"), 'console.log("one");');
    recordArtifact({ exePath: path.join(root, "target/debug/vaultspend.exe"), recordPath: path.join(root, "target/debug/vaultspend.artifact.json"), key: computeBuildKey({ files: collectInputs(root), toolchain: readToolchain(), mode: "debug" }) });
    const result = spawnSync(process.execPath, ["e2e/run-all.mjs", "--schedule=pool", "--concurrency=6"], { cwd: root, encoding: "utf8", timeout: 20000 });
    expect(result.status, result.stderr).toBe(3);
    expect(JSON.parse(fs.readFileSync(path.join(root, "target/e2e-last-run.json"))).problems).toContainEqual(expect.objectContaining({ kind: "unapproved-parallel-pool" }));
  });
  it("classified CLI refuses legacy name-only parallel approval on its actual source", () => {
    fs.writeFileSync(path.join(root, "e2e/smoke.mjs"), 'console.log("one");');
    fs.writeFileSync(path.join(root, "e2e/feature1_fixture.mjs"), 'console.log("two");');
    fs.writeFileSync(path.join(root, "e2e/spec-classification.json"), JSON.stringify({ parallelSafe: ["smoke.mjs", "feature1_fixture.mjs"] }));
    recordArtifact({ exePath: path.join(root, "target/debug/vaultspend.exe"), recordPath: path.join(root, "target/debug/vaultspend.artifact.json"), key: computeBuildKey({ files: collectInputs(root), toolchain: readToolchain(), mode: "debug" }) });
    const result = spawnSync(process.execPath, ["e2e/run-all.mjs", "--schedule=classified", "--concurrency=6"], { cwd: root, encoding: "utf8", timeout: 20000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("0 parallel-safe");
    const receipt = JSON.parse(fs.readFileSync(path.join(root, "target/e2e-last-run.json")));
    expect(receipt.approvalBinding.sourceKey).toMatch(/^[a-f0-9]{64}$/);
  });
  it("preserves successful phase output and before/after validation manifests", () => {
    const { child, receipt } = run('console.log("[phase] fixture-navigation 12ms");');
    expect(child.status, child.stderr).toBe(0);
    expect(receipt.valid).toBe(true);
    expect(receipt.executed).toHaveLength(1);
    expect(receipt.executed[0].output).toContain("[phase] fixture-navigation 12ms");
    expect(receipt.validationManifest.after).toEqual(receipt.validationManifest.before);
    expect(receipt.validationManifest.before["e2e/smoke.mjs"]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not hide an assertion failure or drop its output", () => {
    const { child, receipt } = run('console.error("deliberate assertion failure");process.exitCode=1;');
    expect(child.status).toBe(1);
    expect(receipt.executed[0]).toMatchObject({ name: "smoke.mjs", code: 1 });
    expect(receipt.executed[0].output).toContain("deliberate assertion failure");
    expect(child.stdout).toContain("0/1 passed");
  });
  it("unrecorded diagnostic success is not a green acceptance exit", () => {
    const { child, receipt } = run('console.log("diagnostic only");', false);
    expect(child.status).toBe(3);
    expect(receipt.valid).toBe(false);
    expect(receipt.problems).toContainEqual(expect.objectContaining({ kind: "untrusted-artifact", status: "unknown" }));
  });
});
