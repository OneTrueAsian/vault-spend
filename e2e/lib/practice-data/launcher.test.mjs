import fs from "node:fs";
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

describe("every demo command opens the shared practice data", () => {
  for (const script of ["e2e/demo.mjs", "e2e/household-demo.mjs", "e2e/statements-demo.mjs"]) {
    it(script, () => {
      const source = fs.readFileSync(script, "utf8");
      expect(source).toContain("runPracticeLauncher(");
      expect(source).not.toMatch(/\.demo-household|\.demo-statements|sample-import\.csv/);
    });
  }
});
