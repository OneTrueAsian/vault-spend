// Kind: policy lint (usage); behaviour is in themeMode.test.mjs.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 266 chose Light and then waited ten seconds for a theme that never changed: the one click on the mode button was missed on a hosted runner.
// It now goes through chooseModeUntil (lib/themeMode.mjs), which clicks once, always, then again only while the page has not taken the theme.
const source = fs.readFileSync(new URL("../feature266_page_frame.mjs", import.meta.url), "utf8");

describe("spec 266 choosing Light or Dark in the sidebar", () => {
  it("imports chooseModeUntil from lib/themeMode.mjs and has no copy of its own", () => {
    expect(source).toMatch(/import \{ chooseModeUntil \} from "\.\/lib\/themeMode\.mjs";/);
    expect(source).not.toMatch(/function chooseModeUntil/);
  });
  it("goes through chooseModeUntil at all three places", () => {
    expect(source.match(/await chooseModeUntil\(/g)?.length).toBe(3);
  });
});
