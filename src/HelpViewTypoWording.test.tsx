// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpView } from "./HelpView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Owner decision Q1 (21 October 2026): the Help describes the existing bounded behavior exactly. A unique small typing mistake is corrected and the reading is shown;
 * an unclear name asks the person to choose. The earlier sentence ("it asks you to choose instead of guessing" for any misspelling) overstated the asking.
 * Behavior is unchanged; the behavior itself is pinned in typoRules.test.tsx.
 */
describe("Help wording for typing mistakes", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); act(() => root.render(<HelpView />)); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const search = (words: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, words); input.dispatchEvent(new Event("input", { bubbles: true })); });
    return (container.textContent ?? "").replace(/\s+/g, " ");
  };
  it("says exactly what the owner approved", () => {
    expect(search("plain English")).toContain("I can correct small typing mistakes and show how I read them. If a name is unclear, I’ll ask you to choose.");
  });
  it("no longer says that every misspelled word asks you to choose", () => {
    const text = search("plain English");
    expect(text).not.toContain("or a word looks misspelled, it asks you to choose instead of guessing");
    expect(text).not.toContain("If it is unsure");
  });
});
