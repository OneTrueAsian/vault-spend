import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Exercise the actual generator CLI against isolated source trees, never the repo registration.
describe("classification generation preserves reviewed safety decisions", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-classifier-"));
    fs.mkdirSync(path.join(dir, "lib"));
    fs.copyFileSync("e2e/classify-specs.mjs", path.join(dir, "classify-specs.mjs"));
    fs.copyFileSync("e2e/lib/specAudit.mjs", path.join(dir, "lib/specAudit.mjs"));
    fs.writeFileSync(path.join(dir, "smoke.mjs"), "console.log('smoke');");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const config = value => write("spec-classification.json", JSON.stringify(value));
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, "spec-classification.json"), "utf8"));
  const run = (...args) => spawnSync(process.execPath, [path.join(dir, "classify-specs.mjs"), ...args], { encoding: "utf8" });

  it("retains the manual exclusive rationale AND newly detected reasons without duplicating them", () => {
    write("feature312_trace.mjs", "browser.keys(['Tab']);");
    config({ parallelSafe: [], exclusive: { "feature312_trace.mjs": "reviewed: diagnostic window must be exclusive" } });
    expect(run().status).toBe(0);
    const first = read();
    expect(first.exclusive["feature312_trace.mjs"]).toContain("reviewed: diagnostic window must be exclusive");
    expect(first.exclusive["feature312_trace.mjs"]).toContain("uses the shared keyboard");
    expect(run("--check").status).toBe(0);
    expect(run().status).toBe(0);
    expect(read()).toEqual(first);
  });
  it("preserves a manual exclusive decision even when no shared primitive is detected", () => {
    write("feature1_clean.mjs", "console.log('clean');");
    config({ parallelSafe: [], exclusive: { "feature1_clean.mjs": "reviewed: external diagnostic owns this session" } });
    expect(run().status).toBe(0);
    expect(read().exclusive["feature1_clean.mjs"]).toBe("reviewed: external diagnostic owns this session");
  });
  it("preserves the whole human rationale even when it contains the generator annotation phrase", () => {
    const rationale = "reviewed: retain this clause; detected: this is part of the owner's original rationale";
    write("feature312_trace.mjs", "browser.keys(['Tab']);");
    config({ parallelSafe: [], exclusive: { "feature312_trace.mjs": rationale } });
    expect(run().status).toBe(0);
    const first = read();
    expect(first.exclusive["feature312_trace.mjs"].startsWith(rationale)).toBe(true);
    expect(first.exclusive["feature312_trace.mjs"]).toContain("uses the shared keyboard");
    expect(run().status).toBe(0);
    expect(read()).toEqual(first);
    expect(run("--check").status).toBe(0);
  });
  it("detects transitive keyboard use and demotes a previously safe spec", () => {
    write("lib/inner.mjs", "export const k = b => b.keys('Tab');");
    write("lib/outer.mjs", "export { k } from './inner.mjs';");
    write("feature41_ledger.mjs", "import { k } from './lib/outer.mjs';");
    config({ parallelSafe: ["feature41_ledger.mjs"], exclusive: {} });
    expect(run().status).toBe(0);
    expect(read().parallelSafe).not.toContain("feature41_ledger.mjs");
    expect(read().exclusive["feature41_ledger.mjs"]).toMatch(/inner\.mjs: uses the shared keyboard/);
  });
  it("new clean specs and previously exclusive specs cannot silently become parallel-safe", () => {
    write("feature2_unknown.mjs", "console.log('unknown');");
    write("feature3_old.mjs", "console.log('now clean');");
    config({ parallelSafe: ["smoke.mjs"], exclusive: { "feature3_old.mjs": "previously detected unsafe primitive" } });
    expect(run().status).toBe(0);
    const result = read();
    expect(result.parallelSafe).toEqual(["smoke.mjs"]);
    expect(Object.keys(result.exclusive)).toEqual(["feature2_unknown.mjs", "feature3_old.mjs"]);
    expect(run("--check").status).toBe(0);
  });
  it("unknown imports stay exclusive and all discovered specs survive deterministic regeneration", () => {
    write("feature10_missing.mjs", "import './lib/missing.mjs';");
    write("feature2_new.mjs", "console.log('new');");
    config({ parallelSafe: [], exclusive: {} });
    expect(run("--check").status).toBe(1);
    expect(run().status).toBe(0);
    const first = fs.readFileSync(path.join(dir, "spec-classification.json"), "utf8");
    expect(read().exclusive["feature10_missing.mjs"]).toMatch(/not proven safe/);
    expect(new Set([...read().parallelSafe, ...Object.keys(read().exclusive)])).toEqual(new Set(["smoke.mjs", "feature2_new.mjs", "feature10_missing.mjs"]));
    expect(run().status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "spec-classification.json"), "utf8")).toBe(first);
    expect(run("--check").status).toBe(0);
  });
});
