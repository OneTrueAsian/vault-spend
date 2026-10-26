import { describe, expect, it } from "vitest";
import { describeAskState, waitForAskDialog } from "./askDialogWait.mjs";

/** A stand-in page whose dialog text can change while a wait polls. `waitUntil` is real polling over a fake clock. */
function page({ dialogs = [null], state = { busy: "false", value: "Help me save $5", dialog: null, card: "Ask" }, stateError = null } = {}) {
  let reads = 0;
  const browser = {
    $: selector => {
      const current = () => dialogs[Math.min(Math.max(reads - 1, 0), dialogs.length - 1)];
      return {
        isExisting: async () => { reads++; return current() !== null; },
        getText: async () => { const text = current(); if (text === null) throw new Error(`no element ${selector}`); return text; },
      };
    },
    waitUntil: async (condition, { timeout }) => {
      for (let attempt = 0; attempt < 4; attempt++) { try { if (await condition()) return true; } catch { /* a missing dialog is "not yet" */ } }
      throw new Error(`waitUntil condition timed out after ${timeout}ms`);
    },
    execute: async () => { if (stateError) throw stateError; return state; },
  };
  return browser;
}

describe("waiting for an Ask dialog reports what the page showed when it never opened", () => {
  it("resolves as soon as the dialog says the fragment, with no state read", async () => {
    await expect(waitForAskDialog(page({ dialogs: [null, "Check these details\n$95.00"] }), "Check these details", { timeout: 8000 })).resolves.toBeUndefined();
  });
  it("keeps the caller's message first and appends the form, button, field, dialog and card text", async () => {
    const browser = page({ state: { busy: "true", disabled: ["Ask:true"], value: "Help me", dialog: null, card: "Getting ready to answer…" } });
    const failure = await waitForAskDialog(browser, "Check these details", { timeout: 8000, timeoutMsg: "a plain save phrase should reach the review" }).catch(e => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message.split("\n")[0]).toBe("a plain save phrase should reach the review");
    expect(failure.message).toContain('"busy":"true"');
    expect(failure.message).toContain("Getting ready to answer");
    expect(failure.message).toContain('"value":"Help me"');
    expect(failure.cause.message).toContain("timed out");
  });
  it("names the fragment when the caller gives no message", async () => {
    const failure = await waitForAskDialog(page(), "Check every detail", { timeout: 5000 }).catch(e => e);
    expect(failure.message.split("\n")[0]).toBe('the dialog should say "Check every detail"');
  });
  it("shows a dialog that opened with different text", async () => {
    const failure = await waitForAskDialog(page({ dialogs: ["I can't tell you that yet"], state: { busy: "false", value: "q", dialog: "I can't tell you that yet", card: "" } }), "Check these details", { timeout: 8000 }).catch(e => e);
    expect(failure.message).toContain("I can't tell you that yet");
  });
  it("still fails with the original timeout when the page cannot be read", async () => {
    const failure = await waitForAskDialog(page({ stateError: new Error("session gone") }), "x", { timeout: 1000, timeoutMsg: "m" }).catch(e => e);
    expect(failure.message.split("\n")[0]).toBe("m");
    expect(failure.message).toContain("page state unavailable: session gone");
    expect(failure.cause.message).toContain("timed out");
  });
  it("does not shorten or lengthen the wait it was given", async () => {
    let seen;
    const browser = { ...page({ dialogs: ["ok Check"] }), waitUntil: async (condition, options) => { seen = options; return condition(); } };
    await waitForAskDialog(browser, "Check", { timeout: 5000 });
    expect(seen).toEqual({ timeout: 5000 });
  });
});

describe("describeAskState", () => {
  it("returns the page's own state as JSON text", async () => {
    expect(await describeAskState(page({ state: { busy: "false", value: "v" } }))).toBe('{"busy":"false","value":"v"}');
  });
});
