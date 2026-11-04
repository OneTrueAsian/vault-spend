import fs from "node:fs";
import { describe, expect, it } from "vitest";

// A key press only reaches the app while its window has OS focus, and a hosted runner can take focus away (spec 305 failed its first attempt
// waiting for Escape to close the result). The harness's withFocusRetry re-runs a step only when focus was actually lost; a real failure still throws.
const source = fs.readFileSync(new URL("./retirementScreenMatrix.mjs", import.meta.url), "utf8");

describe("the keyboard check in the retirement screen matrix", () => {
  it("presses Escape and waits for the result to close inside withFocusRetry", () => {
    expect(source).toMatch(/withFocusRetry\(b, async \(\) => \{\s*await b\.keys\("Escape"\);\s*await b\.waitUntil\(async \(\) => !\(await h\.dialogOpen\(\)\), \{ timeout: 5000, timeoutMsg: "keyboard: Escape closes the result" \}\);\s*\}\);/);
  });
});
