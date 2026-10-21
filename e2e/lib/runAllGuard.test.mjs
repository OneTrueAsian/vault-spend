// R1 wired into the runner: `node e2e/run-all.mjs` is refused (exit 2, before any app starts) while someone else holds access or when the
// executable is not the one built from the current inputs; `--list` needs neither. Paths are redirected to a throwaway folder with a
// fake executable, so no app is launched by these tests.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectInputs, computeBuildKey, readToolchain, recordArtifact } from "./buildIdentity.mjs";
import { acquireAccess } from "./exclusiveAccess.mjs";

const repo = path.resolve(".");
let dir, exe, record, lockDir;
const env = () => ({ ...process.env, VAULTSPEND_ACCESS_DIR: lockDir, VAULTSPEND_EXE: exe, VAULTSPEND_ARTIFACT_RECORD: record });
const runAll = (...args) => spawnSync(process.execPath, ["e2e/run-all.mjs", ...args], { cwd: repo, env: env(), encoding: "utf8", timeout: 60000 });
const currentKey = () => computeBuildKey({ files: collectInputs(repo), toolchain: readToolchain(), mode: "debug" });
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-runall-")); exe = path.join(dir, "app.exe"); record = path.join(dir, "artifact.json"); lockDir = path.join(dir, "lock"); fs.writeFileSync(exe, "fake executable"); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("run-all refuses before starting anything", () => {
  it("while another run or build holds access: exit 2, names the holder, leaves it holding", async () => {
    const holder = await acquireAccess({ dir: lockDir, operation: "tauri-build" });
    const result = runAll("--spec=smoke");
    expect(result.status).toBe(2);
    expect(result.stderr + result.stdout).toMatch(/tauri-build/);
    expect(JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")).token).toBe(holder.owner.token);
    holder.release();
  });
  it("with an executable built from different inputs (stale): exit 2 and says to rebuild", () => {
    recordArtifact({ exePath: exe, recordPath: record, key: "0".repeat(64) });
    const result = runAll("--spec=smoke");
    expect(result.status).toBe(2);
    expect(result.stderr + result.stdout).toMatch(/stale/i);
    expect(result.stderr + result.stdout).toMatch(/build:app/);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("with an executable replaced after it was recorded: exit 2", () => {
    recordArtifact({ exePath: exe, recordPath: record, key: currentKey() });
    fs.writeFileSync(exe, "someone rebuilt this");
    const result = runAll("--spec=smoke");
    expect(result.status).toBe(2); expect(result.stderr + result.stdout).toMatch(/changed/i);
  });
  it("with no executable: exit 2", () => {
    fs.rmSync(exe);
    const result = runAll("--spec=smoke");
    expect(result.status).toBe(2); expect(result.stderr + result.stdout).toMatch(/missing/i);
  });
});

describe("--schedule", () => {
  it("rejects an unknown schedule before anything starts", () => {
    const result = runAll("--spec=smoke", "--schedule=fastest");
    expect(result.status).toBe(1); expect(result.stderr).toMatch(/--schedule must be/);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("--list shows the classification under --schedule=classified without starting anything", () => {
    const result = runAll("--list", "--schedule=classified", "--spec=smoke,307");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/smoke\.mjs/);
    expect(result.stdout).toMatch(/feature307_ask_vault_retirement_os_focus\.mjs\s+\[exclusive/);
  });
  it("without --schedule the listing stays the plain list of spec names", () => {
    const result = runAll("--list", "--spec=smoke,307");
    expect(result.stdout.trim().split("\n")).toEqual(["smoke.mjs", "feature307_ask_vault_retirement_os_focus.mjs"]);
  });
});

describe("--list and bad arguments need no access", () => {
  it("--list works while access is held and with a stale executable, and starts nothing", async () => {
    const holder = await acquireAccess({ dir: lockDir, operation: "tauri-build" });
    recordArtifact({ exePath: exe, recordPath: record, key: "0".repeat(64) });
    const result = runAll("--list", "--spec=smoke");
    expect(result.status).toBe(0); expect(result.stdout.trim()).toBe("smoke.mjs");
    holder.release();
  });
  it("an unknown selector still fails the way it always did", () => {
    const result = runAll("--spec=no_such_spec_anywhere");
    expect(result.status).toBe(1); expect(result.stderr).toMatch(/No E2E spec matches/);
  });
});
