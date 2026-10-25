import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { askByKeyboard, withAskReady } from "./askReady.mjs";

describe("compiled questions respect the live Ask readiness guard", () => {
  it("waits for the prepared form before asking, even when the question starts empty", async () => {
    const events = [];
    const browser = { $: async selector => {
      events.push(selector);
      return { waitForExist: async options => { events.push(options); events.push("ready"); } };
    } };
    expect(await withAskReady(browser, async () => { events.push("ask"); return "review"; })).toBe("review");
    expect(events).toEqual(['.ledger-qa-card form[aria-busy="false"]', { timeout: 5000 }, "ready", "ask"]);
  });
  it("does not submit while readiness is still pending", async () => {
    let release;
    let asked = false;
    const pending = new Promise(resolve => { release = resolve; });
    const work = withAskReady({ $: async () => ({ waitForExist: () => pending }) }, () => { asked = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toBe(false);
    release();
    await work;
    expect(asked).toBe(true);
  });
  it("preserves a readiness failure and never asks afterward", async () => {
    const failed = new Error("Ask never became enabled");
    let asked = false;
    await expect(withAskReady({ $: async () => ({ waitForExist: async () => { throw failed; } }) }, () => { asked = true; })).rejects.toBe(failed);
    expect(asked).toBe(false);
  });
});

/** A stand-in page: the question field is always visible, but the form only matches the ready selector once `ready` is set, as in AskVaultCard. */
function keyboardPage() {
  const events = []; let ready = false, onReady = []; let waitError = null;
  const browser = {
    $: async selector => ({ waitForExist: async options => {
      events.push(`wait ${selector} ${JSON.stringify(options)}`);
      if (waitError) throw waitError;
      if (selector.includes('aria-busy="false"') && !ready) await new Promise(resolve => onReady.push(resolve));
      events.push("ready");
    } }),
    execute: async () => { events.push("focus"); },
    keys: async keys => { events.push(`keys ${keys}`); },
  };
  return { browser, events, makeReady: () => { ready = true; onReady.splice(0).forEach(resolve => resolve()); }, failWith: error => { waitError = error; } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("keyboard asking waits for the account list before typing or pressing Enter", () => {
  it("types and submits nothing while the form is still aria-busy, however visible the field is", async () => {
    const page = keyboardPage();
    const asked = askByKeyboard(page.browser, "How much?");
    await flush();
    expect(page.events.some(e => e.startsWith("keys") || e === "focus")).toBe(false);
    page.makeReady();
    await asked;
    expect(page.events.filter(e => e !== "ready" && !e.startsWith("wait"))).toEqual(["focus", "keys How much?", "keys Enter"]);
  });
  it("waits on the exact ready selector, with the same 5 second limit as the other guarded asks", async () => {
    const page = keyboardPage(); page.makeReady();
    await askByKeyboard(page.browser, "q");
    expect(page.events[0]).toBe('wait .ledger-qa-card form[aria-busy="false"] {"timeout":5000}');
  });
  it("still submits with Enter when the form is already ready", async () => {
    const page = keyboardPage(); page.makeReady();
    await askByKeyboard(page.browser, "q");
    expect(page.events).toEqual(['wait .ledger-qa-card form[aria-busy="false"] {"timeout":5000}', "ready", "focus", "keys q", "keys Enter"]);
  });
  it("throws a readiness failure unchanged and never types or presses Enter", async () => {
    const page = keyboardPage(); const failed = new Error("Ask never became enabled"); page.failWith(failed);
    await expect(askByKeyboard(page.browser, "q")).rejects.toBe(failed);
    expect(page.events.some(e => e.startsWith("keys") || e === "focus")).toBe(false);
  });
});

/** Lines of the matrix source that press Enter on a question typed by raw keys, without going through askByKeyboard. */
export function unguardedKeyboardAsks(source) {
  return source.split("\n").map((text, i) => ({ line: i + 1, text })).filter(({ text }) => /\.keys\(QUESTION\w*(\(\))?\);\s*await b\.keys\("Enter"\)/.test(text));
}
describe("the compiled retirement matrix's keyboard walk uses the guarded helper", () => {
  const source = fs.readFileSync(new URL("./retirementScreenMatrix.mjs", import.meta.url), "utf8");
  it("has no question typed with raw keys followed by Enter", () => {
    expect(unguardedKeyboardAsks(source)).toEqual([]);
  });
  it("asks by keyboard at the three keyboard-only submissions", () => {
    expect(source.match(/askByKeyboard\(b, /g)).toHaveLength(3);
  });
  it("would flag the unguarded form this fix replaced", () => {
    expect(unguardedKeyboardAsks('  await b.keys(QUESTION()); await b.keys("Enter");\n  await b.keys(QUESTION_NO_ACCOUNT); await b.keys("Enter");').map(x => x.line)).toEqual([1, 2]);
  });
});
