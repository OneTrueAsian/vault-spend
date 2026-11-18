import fs from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 266 chose Light and then waited ten seconds for a theme that never changed: the one click on the mode button was missed on a hosted runner.
// It still clicks once, always, then clicks again only while the page has not taken the theme.
const source = fs.readFileSync(new URL("../feature266_page_frame.mjs", import.meta.url), "utf8");

describe("spec 266 choosing Light or Dark in the sidebar", () => {
  it("goes through chooseModeUntil at all three places", () => {
    expect(source.match(/await chooseModeUntil\(/g)?.length).toBe(3);
  });
  it("calls chooseMode directly only inside that helper (its first click and its repeat)", () => {
    expect(source.match(/^\s*await chooseMode\(/gm)?.length).toBe(2);
  });
});
