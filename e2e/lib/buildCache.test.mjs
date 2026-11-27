// VS-6: safe cleanup of the external Cargo build-dir (intermediates only; finished executables stay in target/debug).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireAccess } from "./exclusiveAccess.mjs";
import { trimBuildCache } from "./buildCache.mjs";

let root, repo, cache, lockDir;
const DAY = 24 * 60 * 60 * 1000;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-buildcache-"));
  repo = path.join(root, "repo"); cache = path.join(root, "cache"); lockDir = path.join(repo, "target", ".vs-access");
  fs.mkdirSync(path.join(repo, "target", "debug"), { recursive: true }); fs.writeFileSync(path.join(repo, "target", "debug", "vaultspend.exe"), "exe");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const put = (rel, bytes = 10, ageDays = 0) => {
  const file = path.join(cache, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "x".repeat(bytes));
  const when = new Date(Date.now() - ageDays * DAY);
  for (let p = file; p !== cache; p = path.dirname(p)) fs.utimesSync(p, when, when); // a folder's own time counts too
  return file;
};
const run = (over = {}) => trimBuildCache({ buildDir: cache, repoRoot: repo, lockDir, limitBytes: 1000, maxAgeDays: 14, ...over });

describe("path validation", () => {
  it.each(["repo root", "target", "drive root", "relative", "unrecognised folder"])("refuses %s and deletes nothing", async name => {
    const bad = { "repo root": repo, target: path.join(repo, "target"), "drive root": path.parse(root).root, relative: "cache", "unrecognised folder": path.join(root, "documents") }[name];
    fs.mkdirSync(path.join(root, "documents"), { recursive: true }); fs.writeFileSync(path.join(root, "documents", "notes.txt"), "keep");
    await expect(run({ buildDir: bad })).rejects.toThrow(/refus/i);
    expect(fs.existsSync(path.join(repo, "target", "debug", "vaultspend.exe"))).toBe(true);
    expect(fs.existsSync(path.join(root, "documents", "notes.txt"))).toBe(true);
  });
  it("refuses a cache holding anything other than Cargo's own top-level entries", async () => {
    put("debug/deps/a.rlib"); put("my-fixtures/data.json");
    await expect(run()).rejects.toThrow(/refus/i);
    expect(fs.existsSync(path.join(cache, "my-fixtures", "data.json"))).toBe(true);
  });
  it("does nothing when the cache does not exist", async () => {
    await expect(run({ buildDir: path.join(root, "never-built") })).resolves.toMatchObject({ action: "none" });
  });
});

describe("what it removes", () => {
  it("leaves a small, fresh cache alone", async () => {
    put("debug/deps/a.rlib", 100); put("debug/incremental/s1/x", 100);
    expect(await run()).toMatchObject({ action: "none" });
    expect(fs.existsSync(path.join(cache, "debug", "deps", "a.rlib"))).toBe(true);
  });
  it("removes only incremental sessions older than the age limit", async () => {
    put("debug/incremental/old/x", 10, 20); put("debug/incremental/new/x", 10, 1); put("debug/deps/a.rlib", 10, 20);
    expect(await run()).toMatchObject({ action: "aged" });
    expect(fs.existsSync(path.join(cache, "debug", "incremental", "old"))).toBe(false);
    expect(fs.existsSync(path.join(cache, "debug", "incremental", "new", "x"))).toBe(true);
    expect(fs.existsSync(path.join(cache, "debug", "deps", "a.rlib"))).toBe(true);
  });
  it("clears the whole intermediate set together when over the size limit, never touching executables", async () => {
    put("debug/deps/a.rlib", 600); put("debug/.fingerprint/f/x", 600); put("debug/incremental/s/x", 10);
    expect(await run()).toMatchObject({ action: "purged" });
    expect(fs.readdirSync(cache)).toEqual([]);
    expect(fs.existsSync(path.join(repo, "target", "debug", "vaultspend.exe"))).toBe(true);
  });
  it("only reports with dryRun", async () => {
    put("debug/deps/a.rlib", 2000);
    expect(await run({ dryRun: true })).toMatchObject({ action: "purged", dryRun: true });
    expect(fs.existsSync(path.join(cache, "debug", "deps", "a.rlib"))).toBe(true);
  });
});

describe("exclusive access", () => {
  it("skips without deleting while a build or desktop run holds the lock, and stops no process", async () => {
    put("debug/deps/a.rlib", 2000);
    const held = await acquireAccess({ dir: lockDir, operation: "tauri-build" });
    try {
      expect(await run()).toMatchObject({ action: "skipped-busy" });
      expect(fs.existsSync(path.join(cache, "debug", "deps", "a.rlib"))).toBe(true);
    } finally { held.release(); }
  });
  it("holds the lock while deleting and releases it afterwards", async () => {
    put("debug/deps/a.rlib", 2000);
    await run();
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});
