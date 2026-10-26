import { describe, expect, it } from "vitest";
import fs from "node:fs";
import * as w from "./askWindow.mjs";

// Task 7 (owner direction D-7, G-3): the compiled layout window covers 3 styles x light/dark x 720/960/1280 for the affected cells. These tests guard the
// window's own rules so a skipped combination, a missing cell, a Tab walk that leaves the dialog or a focus loss cannot earn a pass.
describe("the compiled Ask window covers every style, theme, width and cell", () => {
  it("has exactly 18 style/theme/width combinations", () => {
    const cells = w.windowCombinations();
    expect(cells).toHaveLength(18);
    expect(new Set(cells.map(c => w.combinationKey(c))).size).toBe(18);
    expect([...new Set(cells.map(c => c.width))].sort()).toEqual([1280, 720, 960].sort());
    expect([...new Set(cells.map(c => c.theme))].sort()).toEqual(["dark", "light"]);
    expect([...new Set(cells.map(c => c.style))].sort()).toEqual(["Default", "Futuristic", "Retro"]);
  });
  it("requires every named cell in every combination, and reports a missing one", () => {
    const required = w.requiredWindowCoverage();
    expect(required).toHaveLength(18 * w.WINDOW_CELLS.length);
    for (const cell of ["ordinary-error", "ordinary-stale-banner", "ordinary-stale", "m3-review-long-category", "m4-choices-long-category"]) expect(w.WINDOW_CELLS).toContain(cell);
    expect(() => w.assertWindowCoverage(new Set(required))).not.toThrow();
    const missing = required.find(k => k.includes("Retro") && k.includes("1280") && k.includes("m4-choices-long-category"));
    expect(missing).toBeTruthy();
    expect(() => w.assertWindowCoverage(new Set(required.filter(k => k !== missing)))).toThrow(/Retro/);
  });
  it("can be narrowed to one combination for sharding, and the narrowed shard still requires all of its cells", () => {
    const only = { style: "Retro", theme: "dark", width: 960 };
    const required = w.requiredWindowCoverage(only);
    expect(required).toHaveLength(w.WINDOW_CELLS.length);
    expect(required.every(k => k.startsWith(w.combinationKey(only)))).toBe(true);
    expect(() => w.assertWindowCoverage(new Set(required.slice(1)), only)).toThrow();
  });
  it("has one shard spec per combination, each registered", () => {
    const classification = JSON.parse(fs.readFileSync("e2e/spec-classification.json", "utf8"));
    const registered = new Set([...classification.parallelSafe, ...Object.keys(classification.exclusive)]);
    for (const c of w.windowCombinations()) {
      const name = w.shardSpecName(c);
      expect(fs.existsSync(`e2e/${name}`), name).toBe(true);
      expect(registered.has(name), name).toBe(true);
      expect(fs.readFileSync(`e2e/${name}`, "utf8"), name).toContain(`VS_ASK_WIDTH = "${c.width}"`);
    }
  });
});

describe("keyboard and focus rules", () => {
  const inside = name => ({ inside: true, name });
  it("accepts a Tab walk that stays inside the dialog and reaches Close", () => {
    expect(() => w.assertTabOrder("m3", [inside("Close"), inside("Show what I would save"), inside("Close")], ["Close"])).not.toThrow();
  });
  it("rejects a Tab walk that leaves the dialog", () => {
    expect(() => w.assertTabOrder("m3", [inside("Close"), { inside: false, name: "Ask" }], ["Close"])).toThrow(/leaves the dialog/);
  });
  it("rejects a Tab walk that never reaches a required control, and an empty walk", () => {
    expect(() => w.assertTabOrder("m4", [inside("Review the details")], ["Close"])).toThrow(/Close/);
    expect(() => w.assertTabOrder("m4", [], ["Close"])).toThrow(/no Tab/);
  });
  it("rejects focus that is not restored to a control after the dialog closes", () => {
    expect(() => w.assertFocusRestored("m3", { onQuestion: true, onBody: false, inCard: true })).not.toThrow();
    expect(() => w.assertFocusRestored("m3", { onQuestion: false, onBody: true, inCard: false })).toThrow(/focus/);
    expect(() => w.assertFocusRestored("m3", { onQuestion: false, onBody: false, inCard: false })).toThrow(/focus/);
    expect(() => w.assertFocusRestored("ordinary-stale", { onQuestion: false, onBody: false, inCard: true }, { questionRequired: false })).not.toThrow();
    expect(() => w.assertFocusRestored("m3", { onQuestion: false, onBody: false, inCard: true })).toThrow(/question/);
  });
  it("accepts the exact invoking Ask control, but not an arbitrary control in the card", () => {
    expect(() => w.assertFocusRestored("m3", { onQuestion: false, onInvoker: true, onBody: false, inCard: true })).not.toThrow();
    expect(() => w.assertFocusRestored("m3", { onQuestion: false, onInvoker: false, onBody: false, inCard: true })).toThrow();
  });
});
