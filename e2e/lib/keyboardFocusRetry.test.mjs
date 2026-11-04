import fs from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 305's Escape check failed two hosted first attempts: once with the window having lost OS focus, once with the window still focused and the
// key simply not closing the result. The step stays inside the harness's withFocusRetry (re-runs only when focus was lost) and presses Escape again
// only while the result is still open, so a missed key press is repeated but a dialog that did close is never pressed again.
const source = fs.readFileSync(new URL("./retirementScreenMatrix.mjs", import.meta.url), "utf8");

describe("the keyboard check in the retirement screen matrix", () => {
  it("presses Escape inside withFocusRetry, again only while the result is open", () => {
    expect(source).toMatch(/withFocusRetry\(b, async \(\) => \{\s*await b\.waitUntil\(async \(\) => \{\s*if \(!\(await h\.dialogOpen\(\)\)\) return true;\s*await b\.keys\("Escape"\);\s*return false;\s*\}, \{ timeout: \d+, interval: \d+, timeoutMsg: "keyboard: Escape closes the result" \}\);\s*\}\);/);
  });
});
