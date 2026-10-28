import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Continuation 12 (T04): the restore confirmation must wrap its buttons under the text on a narrow window instead of squeezing the text to a few characters a line.
// (Written with the fix; the failing-first evidence is the structural test in SettingsView.test.tsx and the compiled screenshots T04-* of ui-closeout-matrix-b2/-e03-t04-1.)
const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
describe("backup restore confirmation layout", () => {
  it("is a wrapping flex row whose message has its own width", () => {
    const row = css.match(/\.backup-restore-confirm\s*\{([^}]*)\}/);
    expect(row, ".backup-restore-confirm rule").not.toBeNull();
    expect(row![1]).toMatch(/display:\s*flex/);
    expect(row![1]).toMatch(/flex-wrap:\s*wrap/);
    const text = css.match(/\.backup-restore-confirm\s+\.backup-restore-warning\s*\{([^}]*)\}/);
    expect(text![1]).toMatch(/flex:\s*1 1 \d+px/);
  });
});
