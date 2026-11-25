// Kind: policy lint (usage); behaviour is in actUntil.test.mjs.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 305's Escape check failed two hosted first attempts: once with the window having lost OS focus, once with the window still focused and the
// key simply not closing the result. The step stays inside the harness's withFocusRetry (re-runs only when focus was lost) and presses Escape again
// only while the result is still open, through actUntil, which also counts and reports every repeat. How that works is tested in actUntil.test.mjs.
const source = fs.readFileSync(new URL("./retirementScreenMatrix.mjs", import.meta.url), "utf8");

describe("the keyboard check in the retirement screen matrix", () => {
  it("imports actUntil and presses Escape through it inside withFocusRetry", () => {
    expect(source).toMatch(/import \{ actUntil \} from "\.\/actUntil\.mjs";/);
    expect(source).toMatch(/withFocusRetry\(b, async \(\) => \{\s*await actUntil\(b, \{[^}]*act: \(\) => b\.keys\("Escape"\)[^}]*"keyboard: Escape closes the result"/);
  });
});
