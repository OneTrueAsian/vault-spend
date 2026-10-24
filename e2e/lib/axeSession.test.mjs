import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ensureAxe } from "./axeSession.mjs";

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
