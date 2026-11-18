import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { launchPlan } from "./launcher.mjs";

const plan = (argv, registryExists, appRunning) => launchPlan({ args: new Set(argv), registryExists, appRunning });

describe("practice data launch plan", () => {
  it("rebuilds and opens by default", () => {
    expect(plan([], true, false)).toEqual({ action: "build", launch: true });
  });
  it("reuses the existing data with --keep", () => {
    expect(plan(["--keep"], true, true)).toEqual({ action: "reuse", launch: true });
  });
  it("builds with --keep when nothing has been built yet", () => {
    expect(plan(["--keep"], false, false)).toEqual({ action: "build", launch: true });
  });
  it("refuses to wipe the data while Vault Spend is running", () => {
    expect(plan([], true, true)).toEqual({ action: "refuse", launch: false });
    expect(plan(["--seed"], false, true)).toEqual({ action: "refuse", launch: false });
  });
  it("builds without opening the app with --seed", () => {
    expect(plan(["--seed"], true, false)).toEqual({ action: "build", launch: false });
  });
});

describe("a Locked profile that did not come out protected stops the build", () => {
  it("rejects an empty recovery key or a missing protected file", async () => {
    const { checkLockedProfile } = await import("./registry.mjs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-locked-check-"));
    try {
      expect(() => checkLockedProfile(dir, "")).toThrow(/init_db/);
      expect(() => checkLockedProfile(dir, "ABCD-EFGH")).toThrow(/init_db/);
      fs.writeFileSync(path.join(dir, "vaultspend-protected.db"), "x");
      fs.writeFileSync(path.join(dir, "vaultspend-protected.db.key"), "x");
      expect(() => checkLockedProfile(dir, "ABCD-EFGH")).not.toThrow();
      fs.writeFileSync(path.join(dir, "vaultspend.db"), "x");
      expect(() => checkLockedProfile(dir, "ABCD-EFGH")).toThrow(/plaintext/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the shared launcher keeps the seeding helper current for every demo command", () => {
  it("builds init_db before building the practice data", () => {
    const source = fs.readFileSync("e2e/lib/practice-data/launcher.mjs", "utf8");
    const build = source.indexOf("--bin\", \"init_db\"");
    expect(build).toBeGreaterThan(0);
    expect(build).toBeLessThan(source.indexOf("await buildPracticeData("));
  });
});

describe("every demo command opens the shared practice data", () => {
  for (const script of ["e2e/demo.mjs", "e2e/household-demo.mjs", "e2e/statements-demo.mjs"]) {
    it(script, () => {
      const source = fs.readFileSync(script, "utf8");
      expect(source).toContain("runPracticeLauncher(");
      expect(source).not.toMatch(/\.demo-household|\.demo-statements|sample-import\.csv/);
    });
  }
});
