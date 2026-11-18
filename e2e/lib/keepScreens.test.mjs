// Keeping a run's screenshots in one folder so they can be reviewed after the run (npm run e2e:review), without changing the specs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countKept, keepScreenshot, keptBySpec, keptCopyPath, startKeptRun, wrapSaveScreenshot } from "./keepScreens.mjs";

let dir, kept, src;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-keep-"));
  kept = path.join(dir, "kept", "feature415");
  src = path.join(dir, "layout-Budget-dark-720.png");
  fs.writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("keeping one screenshot", () => {
  it("returns null and copies nothing when VAULTSPEND_SHOTS_DIR is unset", () => {
    expect(keepScreenshot(src, {})).toBe(null);
    expect(fs.existsSync(path.join(dir, "kept"))).toBe(false);
  });
  it("copies the file byte for byte into the folder, creating it", () => {
    const copy = keepScreenshot(src, { VAULTSPEND_SHOTS_DIR: kept });
    expect(copy).toBe(path.join(kept, "layout-Budget-dark-720.png"));
    expect(fs.readFileSync(copy).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).toBe(true);
  });
  it("adds -2 then -3 when names collide", () => {
    fs.mkdirSync(kept, { recursive: true });
    expect(keptCopyPath(kept, "a.png")).toBe(path.join(kept, "a.png"));
    fs.writeFileSync(path.join(kept, "a.png"), "1");
    expect(keptCopyPath(kept, "a.png")).toBe(path.join(kept, "a-2.png"));
    fs.writeFileSync(path.join(kept, "a-2.png"), "2");
    expect(keptCopyPath(kept, "a.png")).toBe(path.join(kept, "a-3.png"));
  });
});

describe("run folders", () => {
  it("creates a timestamped folder for the run", () => {
    const run = startKeptRun(path.join(dir, "shots"), new Date("2026-11-17T15:04:05Z"));
    expect(path.basename(run)).toBe("2026-11-17T15-04-05");
    expect(fs.statSync(run).isDirectory()).toBe(true);
  });
  it("keeps only the newest three runs, counting the new one", () => {
    const root = path.join(dir, "shots");
    for (const old of ["2026-11-10T09-00-00", "2026-11-11T09-00-00", "2026-11-12T09-00-00", "2026-11-13T09-00-00"]) fs.mkdirSync(path.join(root, old, "spec"), { recursive: true });
    startKeptRun(root, new Date("2026-11-17T15:04:05Z"));
    expect(fs.readdirSync(root).sort()).toEqual(["2026-11-12T09-00-00", "2026-11-13T09-00-00", "2026-11-17T15-04-05"]);
  });
  it("counts kept screenshots per spec that ran, including specs that kept none", () => {
    const run = path.join(dir, "run");
    fs.mkdirSync(path.join(run, "feature415_default_palette_layout"), { recursive: true });
    for (const f of ["a.png", "b.png"]) fs.writeFileSync(path.join(run, "feature415_default_palette_layout", f), "x");
    expect(keptBySpec(run, ["feature415_default_palette_layout.mjs", "feature306_ask_vault_retirement_lifecycle.mjs"])).toEqual([
      { spec: "feature415_default_palette_layout.mjs", count: 2 },
      { spec: "feature306_ask_vault_retirement_lifecycle.mjs", count: 0 },
    ]);
  });
  it("counts PNGs in nested spec folders and ignores other files", () => {
    const run = path.join(dir, "run");
    fs.mkdirSync(path.join(run, "feature415"), { recursive: true });
    fs.mkdirSync(path.join(run, "feature414"), { recursive: true });
    for (const f of ["feature415/a.png", "feature415/b.png", "feature414/c.png", "feature414/notes.json", "summary.md"]) fs.writeFileSync(path.join(run, f), "x");
    expect(countKept(run)).toBe(3);
  });
});

describe("the session hook", () => {
  // Like a real WebdriverIO session: commands are read-only properties, replaced only through overwriteCommand(name, (orig, ...args) => ...).
  const sessionWith = (command) => {
    const browser = { overwrites: [] };
    Object.defineProperty(browser, "saveScreenshot", { value: command, writable: false, configurable: true });
    browser.overwriteCommand = (name, fn) => {
      const orig = browser[name];
      browser.overwrites.push(name);
      Object.defineProperty(browser, name, { value: (...args) => fn(orig, ...args), writable: false, configurable: true });
    };
    return browser;
  };
  const fakeBrowser = () => sessionWith(async (p) => { fs.writeFileSync(p, "png-bytes"); return Buffer.from("png-bytes"); });
  it("keeps the original result and file, and adds one copy", async () => {
    const browser = fakeBrowser();
    wrapSaveScreenshot(browser, { VAULTSPEND_SHOTS_DIR: kept });
    const target = path.join(dir, "spec-own", "shot.png");
    fs.mkdirSync(path.dirname(target));
    const result = await browser.saveScreenshot(target);
    expect(result.toString()).toBe("png-bytes");
    expect(fs.readFileSync(target, "utf8")).toBe("png-bytes");
    expect(fs.readdirSync(kept)).toEqual(["shot.png"]);
  });
  it("still returns the screenshot when the copy fails, so keeping never fails a spec", async () => {
    fs.writeFileSync(path.join(dir, "not-a-folder"), "x"); // the kept folder path is a file, so the copy cannot be made
    const browser = fakeBrowser();
    wrapSaveScreenshot(browser, { VAULTSPEND_SHOTS_DIR: path.join(dir, "not-a-folder", "spec") });
    const target = path.join(dir, "shot.png");
    const result = await browser.saveScreenshot(target);
    expect(result.toString()).toBe("png-bytes");
    expect(fs.readFileSync(target, "utf8")).toBe("png-bytes");
  });
  it("rethrows the original error and copies nothing", async () => {
    const browser = sessionWith(async () => { throw new Error("boom"); });
    wrapSaveScreenshot(browser, { VAULTSPEND_SHOTS_DIR: kept });
    await expect(browser.saveScreenshot(path.join(dir, "x.png"))).rejects.toThrow("boom");
    expect(fs.existsSync(kept) ? fs.readdirSync(kept) : []).toEqual([]);
  });
  it("changes nothing when the variable is unset", () => {
    const browser = fakeBrowser();
    const original = browser.saveScreenshot;
    wrapSaveScreenshot(browser, {});
    expect(browser.saveScreenshot).toBe(original);
    expect(browser.overwrites).toEqual([]);
  });
});
