import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, isolatedTempEnv, keepTempFiles, makeTempDir, releaseTempDir, removeDir, removeStaleDirs } from "./tempDir.mjs";

// Every throwaway folder the E2E suite makes has to be deleted again. A full run launches the app a few
// hundred times, and each launch used to leave a WebView2 profile (msedgedriver's scoped_dir*) and a database
// folder behind in the temp folder, which grew to hundreds of gigabytes.

const realKeep = process.env.VAULTSPEND_KEEP_E2E_TEMP;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vs-tempdir-test-"));
afterEach(() => {
  if (realKeep === undefined) delete process.env.VAULTSPEND_KEEP_E2E_TEMP;
  else process.env.VAULTSPEND_KEEP_E2E_TEMP = realKeep;
  cleanupTempDirs();
});

function fill(dir) {
  fs.mkdirSync(path.join(dir, "EBWebView", "Default"), { recursive: true });
  fs.writeFileSync(path.join(dir, "EBWebView", "Default", "data"), "x".repeat(1024));
  fs.writeFileSync(path.join(dir, "vaultspend.db"), "db");
}

describe("makeTempDir", () => {
  it("makes a new folder under the temp folder with the given prefix", () => {
    const dir = makeTempDir("vs-unit-");
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(path.dirname(dir)).toBe(os.tmpdir());
    expect(path.basename(dir).startsWith("vs-unit-")).toBe(true);
  });

  it("is deleted, with everything in it, by cleanupTempDirs", () => {
    const a = makeTempDir("vs-unit-");
    const b = makeTempDir("vs-unit-", { base: scratch });
    fill(a);
    fill(b);
    cleanupTempDirs();
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
  });

  it("is deleted whether or not the spec failed", () => {
    const dir = makeTempDir("vs-unit-");
    const exitCode = process.exitCode;
    process.exitCode = 1;
    try {
      cleanupTempDirs();
    } finally {
      process.exitCode = exitCode;
    }
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("is kept when VAULTSPEND_KEEP_E2E_TEMP=1 asks to keep it for debugging", () => {
    process.env.VAULTSPEND_KEEP_E2E_TEMP = "1";
    expect(keepTempFiles()).toBe(true);
    const dir = makeTempDir("vs-unit-");
    cleanupTempDirs();
    expect(fs.existsSync(dir)).toBe(true);
    delete process.env.VAULTSPEND_KEEP_E2E_TEMP;
    cleanupTempDirs();
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("releaseTempDir", () => {
  it("deletes a folder made by makeTempDir straight away", () => {
    const dir = makeTempDir("vs-unit-");
    fill(dir);
    releaseTempDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("keeps it when VAULTSPEND_KEEP_E2E_TEMP=1", () => {
    process.env.VAULTSPEND_KEEP_E2E_TEMP = "1";
    const dir = makeTempDir("vs-unit-");
    releaseTempDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
    delete process.env.VAULTSPEND_KEEP_E2E_TEMP;
    cleanupTempDirs();
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("removeDir", () => {
  it("deletes a folder tree and ignores one that is already gone", () => {
    const dir = fs.mkdtempSync(path.join(scratch, "rm-"));
    fill(dir);
    removeDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(() => removeDir(dir)).not.toThrow();
  });
});

describe("isolatedTempEnv", () => {
  it("points every way a Windows program finds its temp folder at the given folder", () => {
    expect(isolatedTempEnv("C:\\x")).toEqual({ TEMP: "C:\\x", TMP: "C:\\x" });
  });
});

describe("removeStaleDirs", () => {
  it("deletes only folders older than the cutoff, leaving a run still in progress alone", () => {
    const root = fs.mkdtempSync(path.join(scratch, "runs-"));
    const old = path.join(root, "old");
    const recent = path.join(root, "recent");
    fill((fs.mkdirSync(old), old));
    fill((fs.mkdirSync(recent), recent));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(old, twoHoursAgo, twoHoursAgo);
    removeStaleDirs(root, 60 * 60 * 1000);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it("does nothing when the folder does not exist yet", () => {
    expect(() => removeStaleDirs(path.join(scratch, "missing"), 1000)).not.toThrow();
  });
});

process.on("exit", () => removeDir(scratch));
