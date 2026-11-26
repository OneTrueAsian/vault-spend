import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { describeAxeViolations, ensureAxe, waitForAnimationsToSettle } from "./axeSession.mjs";

const version = "fixture-axe-1";
const source = `window.axe = { version: ${JSON.stringify(version)}, run() { return Promise.resolve({ violations: [] }); } };`;
function page() {
  let realm;
  const navigate = () => { realm = vm.createContext({ document: {} }); realm.window = realm; };
  navigate();
  const calls = [];
  return { calls, navigate, realm: () => realm, browser: { execute: async (script, ...args) => {
    calls.push(typeof script === "string" ? "inject" : "read");
    if (typeof script === "string") return vm.runInContext(script, realm);
    realm.args = args;
    return vm.runInContext(`(${script.toString()})(...args)`, realm);
  } } };
}

describe("Axe transport reuse, never skipped accessibility assertions", () => {
  it("supports an explicit original-transport baseline without caching, with every injection still executed", async () => {
    const p = page();
    await ensureAxe(p.browser, { source, version, reuse: false });
    await ensureAxe(p.browser, { source, version, reuse: false });
    expect(p.calls).toEqual(["inject", "inject"]);
    expect(await p.realm().axe.run()).toEqual({ violations: [] });
  });
  it("injects once across repeated inspections of the same document", async () => {
    const p = page();
    await ensureAxe(p.browser, { source, version });
    const first = p.realm().axe;
    await ensureAxe(p.browser, { source, version });
    await ensureAxe(p.browser, { source, version });
    expect(p.calls.filter(c => c === "inject")).toHaveLength(1);
    expect(p.realm().axe).toBe(first);
    expect(await p.realm().axe.run()).toEqual({ violations: [] });
  });
  it("reinjects after reload/navigation instead of trusting the previous window", async () => {
    const p = page();
    await ensureAxe(p.browser, { source, version }); p.navigate();
    await ensureAxe(p.browser, { source, version });
    expect(p.calls.filter(c => c === "inject")).toHaveLength(2);
  });
  it("does not trust a pre-existing copy with a matching version but no injection provenance", async () => {
    const p = page(); p.realm().axe = { version, run: () => "not our copy" };
    await ensureAxe(p.browser, { source, version });
    expect(p.calls.filter(c => c === "inject")).toHaveLength(1);
    expect(await p.realm().axe.run()).toEqual({ violations: [] });
  });
  it("reinjects when a stored instance is replaced or damaged", async () => {
    const p = page(); await ensureAxe(p.browser, { source, version });
    p.realm().axe = { version, run: null };
    await ensureAxe(p.browser, { source, version });
    expect(p.calls.filter(c => c === "inject")).toHaveLength(2);
    expect(typeof p.realm().axe.run).toBe("function");
  });
  it("rejects an injected library with the wrong version or missing run API", async () => {
    for (const bad of ['window.axe = { version: "wrong", run() {} };', `window.axe = { version: ${JSON.stringify(version)} };`]) {
      const p = page(); await expect(ensureAxe(p.browser, { source: bad, version })).rejects.toThrow(/Axe|axe/);
    }
  });
  it("propagates injection errors; it cannot turn an inaccessible page into a pass", async () => {
    const p = page();
    await expect(ensureAxe(p.browser, { source: 'throw new Error("injection failure")', version })).rejects.toThrow("injection failure");
    expect(p.calls.filter(c => c === "inject")).toHaveLength(1);
  });
  it("never shares provenance between two live app sessions", async () => {
    const a = page(), b = page();
    await ensureAxe(a.browser, { source, version }); await ensureAxe(b.browser, { source, version });
    expect(a.calls.filter(c => c === "inject")).toHaveLength(1); expect(b.calls.filter(c => c === "inject")).toHaveLength(1);
    expect(a.realm().axe).not.toBe(b.realm().axe);
  });
});

describe("Axe failure details", () => {
  const contrast = { id: "color-contrast", nodes: [{
    target: [".holding-import-drop > .field-hint"], html: '<p class="field-hint">Drop one CSV file here</p>',
    any: [{ data: { fgColor: "#6b7280", bgColor: "#f0f5fb", contrastRatio: 4.1, expectedContrastRatio: "4.5:1", fontSize: "9.0pt (12px)", fontWeight: "normal" },
      relatedNodes: [{ target: [".modal-overlay"], html: '<div class="modal-overlay">' }] }],
  }] };
  it("reports nothing when there are no violations", () => {
    expect(describeAxeViolations([])).toEqual([]);
  });
  it("names the rule, selector, colours, ratio, element and what sits behind it", () => {
    const [line] = describeAxeViolations([contrast]);
    for (const part of ["color-contrast", ".holding-import-drop > .field-hint", "#6b7280", "#f0f5fb", "4.1", "4.5:1", "Drop one CSV file here", ".modal-overlay"]) expect(line).toContain(part);
  });
  it("still names a violation that carries no contrast data", () => {
    const [line] = describeAxeViolations([{ id: "label", nodes: [{ target: ["#a"], html: "<input>" }] }]);
    expect(line).toContain("label"); expect(line).toContain("#a"); expect(line).toContain("<input>");
  });
});

describe("waitForAnimationsToSettle, so axe never samples a colour mid-fade (VS-125, VS-134)", () => {
  const animation = (iterations, finished) => ({ effect: { getComputedTiming: () => ({ iterations }) }, finished });
  // Runs the in-browser callback in a realm whose document reports the given animations.
  const browserWith = animations => ({ executeAsync: script => new Promise(resolve => {
    const realm = vm.createContext({ document: { fonts: { ready: Promise.resolve() }, getAnimations: () => animations }, requestAnimationFrame: cb => setTimeout(cb, 0), setTimeout });
    realm.window = realm; realm.resolve = resolve;
    vm.runInContext(`(${script.toString()})(resolve)`, realm);
  }) });
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  it("does not return until every finite animation or transition has finished", async () => {
    let finish; const running = animation(1, new Promise(resolve => { finish = resolve; }));
    let settled = false; const wait = waitForAnimationsToSettle(browserWith([running])).then(value => { settled = value; });
    await tick(); expect(settled).toBe(false);
    finish(); await wait; expect(settled).toBe(true);
  });
  it("does not wait for infinite animations such as progress spinners", async () => {
    await expect(waitForAnimationsToSettle(browserWith([animation(Infinity, new Promise(() => {}))]))).resolves.toBe(true);
  });
  it("carries on when an animation is cancelled instead of finishing", async () => {
    await expect(waitForAnimationsToSettle(browserWith([animation(1, Promise.reject(new Error("cancelled")))]))).resolves.toBe(true);
  });
});
