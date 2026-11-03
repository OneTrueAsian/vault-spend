import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildArtifact } from "./buildApp.mjs";
import { computeBuildKey } from "./buildIdentity.mjs";
import { MANIFEST_NAME, receiveBuild, stageBuild } from "./buildTransfer.mjs";
import { beginGuardedRun, GuardRefusal } from "./runGuard.mjs";

// The real builder, record, key and guard run here. Only the compiler is a stand-in, and the "second job" is a different directory tree.
const toolchain = { node: "v22.1.0", rustc: "rustc 1.90.0", cargo: "cargo 1.90.0" };
const inputs = { "src/main.tsx": "same-app", "Cargo.lock": "locked", "@build/environment": JSON.stringify({ CARGO_PROFILE_DEV_OPT_LEVEL: "1" }), "e2e/feature1.mjs": "a-test" };
let building, testing;
const paths = root => ({ exePath: path.join(root, "target", "debug", "vaultspend.exe"), recordPath: path.join(root, "target", "debug", "vaultspend.artifact.json"), initDbPath: path.join(root, "target", "debug", "init_db.exe"), lockDir: path.join(root, "lock") });
const guardOptions = (root, files = inputs, tc = toolchain) => ({ operation: "fixture", ...paths(root), collectInputs: () => files, toolchain: tc, mode: "debug" });
const SHA = "a".repeat(40);

beforeEach(async () => {
  building = fs.mkdtempSync(path.join(os.tmpdir(), "vs-transfer-build-"));
  testing = fs.mkdtempSync(path.join(os.tmpdir(), "vs-transfer-test-"));
  const p = paths(building);
  await buildArtifact({ ...guardOptions(building), runBuild: async () => { fs.mkdirSync(path.dirname(p.exePath), { recursive: true }); fs.writeFileSync(p.exePath, "compiled output"); } });
  fs.writeFileSync(p.initDbPath, "fixture tool");
});
afterEach(() => { fs.rmSync(building, { recursive: true, force: true }); fs.rmSync(testing, { recursive: true, force: true }); });

const stage = () => stageBuild({ ...paths(building), stageDir: path.join(building, "stage"), sourceSha: SHA, inputs, toolchain, mode: "debug" });
const receive = (over = {}) => receiveBuild({ ...paths(testing), stageDir: path.join(building, "stage"), sourceSha: SHA, inputs, toolchain, mode: "debug", ...over });

describe("a transferred executable and the unchanged build-identity guard", () => {
  it("is accepted as fresh, and the ordinary run guard then accepts it as valid evidence", async () => {
    const manifest = stage();
    expect(manifest.buildKey).toBe(computeBuildKey({ files: inputs, toolchain, mode: "debug" }));
    const received = receive();
    expect(received).toMatchObject({ status: "fresh", problems: [] });
    const guard = await beginGuardedRun(guardOptions(testing));
    expect(guard.artifact.status).toBe("fresh");
    const verdict = await guard.finish();
    expect(verdict.valid).toBe(true);
    expect(verdict.identity.exeSha256).toBe(manifest.exeSha256);
    expect(verdict.identity.buildKey).toBe(manifest.buildKey);
    expect(fs.readFileSync(paths(testing).initDbPath, "utf8")).toBe("fixture tool");
  });
  it("copies the record unchanged: nothing is re-recorded on the receiving side", () => {
    stage(); receive();
    expect(fs.readFileSync(paths(testing).recordPath, "utf8")).toBe(fs.readFileSync(paths(building).recordPath, "utf8"));
  });
  it("is refused by the guard when a build input differs in the receiving job", async () => {
    stage();
    const other = { ...inputs, "src/main.tsx": "edited-app" };
    const received = receive({ inputs: other });
    expect(received.status).toBe("stale");
    expect(received.problems).toContain("Build input differs: src/main.tsx");
    await expect(beginGuardedRun(guardOptions(testing, other))).rejects.toBeInstanceOf(GuardRefusal);
  });
  it("is refused when the build environment differs (for example a different compiled profile)", async () => {
    stage();
    const other = { ...inputs, "@build/environment": JSON.stringify({ CARGO_PROFILE_DEV_OPT_LEVEL: "2" }) };
    expect(receive({ inputs: other }).status).toBe("stale");
    await expect(beginGuardedRun(guardOptions(testing, other))).rejects.toBeInstanceOf(GuardRefusal);
  });
  it("is refused when the toolchain differs", async () => {
    stage();
    const other = { ...toolchain, rustc: "rustc 1.91.0" };
    const received = receive({ toolchain: other });
    expect(received.status).toBe("stale");
    expect(received.problems.some(p => p.startsWith("Toolchain rustc differs"))).toBe(true);
    await expect(beginGuardedRun(guardOptions(testing, inputs, other))).rejects.toBeInstanceOf(GuardRefusal);
  });
  it("is refused when the checkout is a different commit", () => {
    stage();
    expect(receive({ sourceSha: "b".repeat(40) }).problems.some(p => p.includes("this job checked out"))).toBe(true);
  });
  it("is refused when the executable was altered in transit", async () => {
    stage();
    fs.writeFileSync(path.join(building, "stage", "vaultspend.exe"), "tampered");
    const received = receive();
    expect(received.status).toBe("changed");
    expect(received.problems.some(p => p.includes("SHA-256 differs"))).toBe(true);
    await expect(beginGuardedRun(guardOptions(testing))).rejects.toBeInstanceOf(GuardRefusal);
  });
  it("is not accepted without its build record", async () => {
    stage();
    fs.rmSync(path.join(building, "stage", "vaultspend.artifact.json"));
    expect(receive().status).toBe("missing");
    // Nothing was copied, so there is no executable to run against.
    await expect(beginGuardedRun(guardOptions(testing))).rejects.toBeInstanceOf(GuardRefusal);
  });
  it("is not accepted without its manifest", () => {
    stage(); fs.rmSync(path.join(building, "stage", MANIFEST_NAME));
    expect(receive().status).toBe("unknown");
  });
  it("is never staged from a build that is not fresh", () => {
    expect(() => stageBuild({ ...paths(building), stageDir: path.join(building, "stage"), sourceSha: SHA, inputs: { ...inputs, "src/main.tsx": "later-edit" }, toolchain, mode: "debug" })).toThrow(/not fresh \(stale\)/);
  });
  it("does not carry test files or secrets in the manifest", () => {
    const manifest = stage();
    expect(Object.keys(manifest.buildInputs).sort()).toEqual(["@build/environment", "Cargo.lock", "src/main.tsx"]);
  });
});
