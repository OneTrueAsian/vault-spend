// R2a: every desktop spec is classified, and a spec whose source (or a helper it imports) touches OS foreground, keyboard, hover, window
// geometry, native dialogs or the clipboard can never be listed as parallel-safe. Those primitives are shared by every window on the desktop.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateClassification } from "./scheduler.mjs";
import { auditSpec, discoverSpecs, sharedResourceReasons } from "./specAudit.mjs";

const e2eDir = path.resolve("e2e");

describe("shared-resource detection", () => {
  it.each([
    ["await reclaimWindowFocus(browser);", /focus/i],
    ["await withFocusRetry(browser, async () => {});", /focus/i],
    ["document.hasFocus()", /focus/i],
    ["await chooseMenuOption(b, trigger, 'x')", /menu|focus/i],
    ["await pickFromMenu(b, trigger, 'x')", /menu|focus/i],
    ["await el.moveTo(); // hover", /hover|pointer/i],
    ["await browser.keys(['Tab'])", /keyboard/i],
    ["await browser.performActions([{ type: 'key' }])", /keyboard|pointer/i],
    ["await browser.maximizeWindow()", /window/i],
    ["await browser.switchToWindow(handle)", /window/i],
    ["spawn('notepad.exe')", /foreground|window/i],
    ["openFocusWindow()", /foreground|window/i],
    ["navigator.clipboard.writeText('x')", /clipboard/i],
    ["window.addEventListener('blur', f)", /blur/i],
    ["document.activeElement", /focus/i],
  ])("flags %s", (source, reason) => {
    const reasons = sharedResourceReasons(source);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(" ")).toMatch(reason);
  });
  it("finds nothing in a spec that only drives the page's own DOM through script", () => {
    expect(sharedResourceReasons("await b.execute(() => document.querySelector('button').click()); assert.equal(await h.text(), 'x');")).toEqual([]);
  });
  it("resizing the spec's own window does not touch any other window, so it is not a shared resource", () => {
    expect(sharedResourceReasons("await browser.setWindowSize(720, 800);")).toEqual([]);
  });
});

describe("auditing a spec and the helpers it imports", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-audit-")); fs.mkdirSync(path.join(dir, "lib")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  it("a clean spec with clean helpers has no reasons", () => {
    write("lib/clean.mjs", "export const x = 1;"); write("feature1_a.mjs", "import { x } from './lib/clean.mjs'; console.log(x);");
    expect(auditSpec(path.join(dir, "feature1_a.mjs"))).toEqual([]);
  });
  it("a focus primitive inside an imported helper counts against the spec (transitively)", () => {
    write("lib/inner.mjs", "export const f = b => b.keys(['Tab']);"); write("lib/outer.mjs", "import { f } from './inner.mjs'; export const g = f;");
    write("feature2_b.mjs", "import { g } from './lib/outer.mjs'; g();");
    const reasons = auditSpec(path.join(dir, "feature2_b.mjs"));
    expect(reasons.length).toBeGreaterThan(0); expect(reasons.join(" ")).toMatch(/lib[\\/]inner\.mjs/);
  });
  it("the shared harness is not scanned (it defines the helpers; only specs that call them are affected)", () => {
    write("harness.mjs", "export const reclaimWindowFocus = () => {}; export const launchApp = () => {};");
    write("feature3_c.mjs", "import { launchApp } from './harness.mjs'; await launchApp();");
    expect(auditSpec(path.join(dir, "feature3_c.mjs"))).toEqual([]);
  });
  it("an import cycle does not loop forever", () => {
    write("lib/a.mjs", "import './b.mjs';"); write("lib/b.mjs", "import './a.mjs';"); write("feature4_d.mjs", "import './lib/a.mjs';");
    expect(auditSpec(path.join(dir, "feature4_d.mjs"))).toEqual([]);
  });
  it("an unreadable import is reported as a reason (unknown means not proven safe)", () => {
    write("feature5_e.mjs", "import './lib/missing.mjs';");
    expect(auditSpec(path.join(dir, "feature5_e.mjs")).join(" ")).toMatch(/missing\.mjs/);
  });
});

describe("the repository's classification", () => {
  const specs = discoverSpecs(e2eDir);
  const config = JSON.parse(fs.readFileSync(path.join(e2eDir, "spec-classification.json"), "utf8"));
  it("discovers smoke and every feature spec", () => {
    expect(specs).toContain("smoke.mjs");
    expect(specs.length).toBeGreaterThan(200);
    expect(new Set(specs).size).toBe(specs.length);
  });
  it("names only specs that exist, lists none twice and none in both lists", () => expect(validateClassification(specs, config)).toEqual([]));
  it("lists every exclusive spec with the reason it is exclusive", () => {
    for (const [name, reason] of Object.entries(config.exclusive)) expect(typeof reason === "string" && reason.length > 8, name).toBe(true);
  });
  it("never lists a spec as parallel-safe when it, or a helper it imports, touches a shared desktop resource", () => {
    const offenders = config.parallelSafe.filter(name => auditSpec(path.join(e2eDir, name)).length > 0);
    expect(offenders).toEqual([]);
  });
  it("classifies each existing spec as parallel-safe or exclusive explicitly (new specs stay exclusive until classified)", () => {
    const explicit = new Set([...config.parallelSafe, ...Object.keys(config.exclusive)]);
    expect(specs.filter(name => !explicit.has(name))).toEqual([]);
  });
  it("keeps the known foreground-stealing and focus-locking specs exclusive", () => {
    for (const name of specs.filter(n => /^feature(307|121|122|286)_/.test(n))) expect(config.parallelSafe, name).not.toContain(name);
  });
});
