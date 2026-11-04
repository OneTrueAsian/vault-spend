import fs from "node:fs";
import { describe, expect, it } from "vitest";

// The retirement dialog's loading screen ("Reading your investment account... Nothing has been calculated yet.") contains the same words as the
// account-choice screen, so waiting for those words passes on the loading screen. Spec 304 failed its first hosted attempt twice by reading the
// choices at that moment. It must wait for an account name before reading them.
const source = fs.readFileSync(new URL("../feature304_ask_vault_retirement_flow.mjs", import.meta.url), "utf8");

describe("spec 304 reading the account choices", () => {
  it.each(["choices", "choices after Change the details"])("waits for an account to be listed before reading them (%s)", label => {
    const wait = `await waitText("Nothing has been calculated yet", "${label}");`;
    const at = source.indexOf(wait);
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at + wait.length, at + wait.length + 120)).toMatch(/^\s*await waitText\("M5 IRA"/);
  });
});
