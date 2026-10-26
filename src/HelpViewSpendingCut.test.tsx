// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpView } from "./HelpView";
import { MORE_EXAMPLES } from "./AskVaultCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** D-S3-05 (UC-08): one short Help entry for the spending what-if, with the same example sentence that the Tips list offers. */
describe("Help entry for the spending what-if", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); act(() => root.render(<HelpView />)); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const search = (words: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, words); input.dispatchEvent(new Event("input", { bubbles: true })); });
    return (container.textContent ?? "").replace(/\s+/g, " ");
  };
  const EXAMPLE = "What if I cut Groceries by $50 a month?";
  it("is found by what a person would search for", () => {
    for (const words of ["spend less", "what if", "cut"]) expect(search(words), words).toContain("What if I spent less on one category?");
  });
  it("quotes the exact clickable example, which is the last one in the Tips list", () => {
    expect(MORE_EXAMPLES.at(-1)).toBe(EXAMPLE);
    expect(search("spend less")).toContain(EXAMPLE);
    const quoted = [...container.querySelectorAll("q")].map(q => q.textContent);
    expect(quoted).toContain(EXAMPLE);
  });
  it("says what is chosen, what is reviewed, and that nothing is advised or changed", () => {
    const text = search("spend less");
    for (const phrase of ["one category", "every month or just once", "dates", "usual spending", "before any result is shown", "not advice", "never changes your budget", "closes it"]) expect(text, phrase).toContain(phrase);
  });
  it("uses plain words and promises nothing about investing or accounts", () => {
    const text = search("spend less");
    expect(text).not.toMatch(/guarantee|tracked|published|portfolio/i);
  });
  it("leaves the other Ask the Vault entries where they were", () => {
    const text = search("ask the vault");
    for (const question of ["Can I ask questions about my spending in plain English?", "How can I preview cuts to meet a savings target?", "What could extra money in an investment account add by my retirement month?", "What if I spent less on one category?"])
      expect(text, question).toContain(question);
  });
});
