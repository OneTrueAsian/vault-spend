// `node e2e/with-access.mjs <operation> -- <command>`: a command that uses the shared target\ directory (cargo, a hand-run tauri
// command) runs only while it holds exclusive access, passes its exit code through, and never disturbs another holder.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireAccess } from "./exclusiveAccess.mjs";

let dir, lockDir;
const withAccess = (args, env = {}) => spawnSync(process.execPath, ["e2e/with-access.mjs", ...args], { cwd: path.resolve("."), env: { ...process.env, VAULTSPEND_ACCESS_DIR: lockDir, ...env }, encoding: "utf8", timeout: 30000 });
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-with-access-")); lockDir = path.join(dir, "lock"); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("with-access", () => {
  it("holds access while the command runs, and frees it afterwards", () => {
    const probe = `process.exit(require('fs').existsSync(${JSON.stringify(path.join(lockDir, "owner.json"))}) ? 0 : 9)`;
    expect(withAccess(["cargo-test", "--", process.execPath, "-e", probe]).status).toBe(0);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("passes the command's exit code through and still frees access", () => {
    expect(withAccess(["cargo-test", "--", process.execPath, "-e", "process.exit(7)"]).status).toBe(7);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("waits for a holder to finish, then runs", async () => {
    const holder = await acquireAccess({ dir: lockDir, operation: "desktop-run" });
    const marker = path.join(dir, "ran-after-wait.txt");
    // Asynchronous on purpose: a blocking spawn would freeze the timer that releases the holder.
    const child = spawn(process.execPath, ["e2e/with-access.mjs", "cargo-test", "--", process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`], { cwd: path.resolve("."), env: { ...process.env, VAULTSPEND_ACCESS_DIR: lockDir }, stdio: "ignore" });
    const exited = new Promise(resolve => child.on("close", resolve));
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(fs.existsSync(marker)).toBe(false); // still waiting: the holder has not let go
    holder.release();
    expect(await exited).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
  }, 20000);
  it("passes arguments with quotes and spaces through exactly", () => {
    const out = path.join(dir, "arg with spaces.txt");
    const result = withAccess(["cargo-test", "--", process.execPath, "-e", `require('fs').writeFileSync(process.argv[1], process.argv[2])`, out, 'say "hi" now']);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toBe('say "hi" now');
  });
  it("gives up with exit 2, names the holder, runs nothing, and leaves the holder holding", async () => {
    const holder = await acquireAccess({ dir: lockDir, operation: "desktop-run" });
    const marker = path.join(dir, "ran.txt");
    const result = withAccess(["cargo-test", "--", process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`], { VAULTSPEND_ACCESS_TIMEOUT_MS: "200" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/desktop-run/);
    expect(fs.existsSync(marker)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")).token).toBe(holder.owner.token);
    holder.release();
  });
  it.each([[[]], [["only-an-operation"]], [["op", "--"]], [["--", "cmd"]]])("refuses a malformed command line %j with a usage message", args => {
    const result = withAccess(args);
    expect(result.status).toBe(64); expect(result.stderr).toMatch(/Usage/);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it.skipIf(process.platform !== "win32")("starts a .cmd launcher such as npx (needs a shell on Windows) and keeps its exit code", () => {
    const result = withAccess(["npx-probe", "--", "npx", "--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
  it("a command that cannot be started frees access and fails", () => {
    const result = withAccess(["cargo-test", "--", "definitely-not-a-real-program-xyz"]);
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});
