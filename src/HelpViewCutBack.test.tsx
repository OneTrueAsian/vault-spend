// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpView } from "./HelpView";
import { isCutBackQuestion } from "./askVault/cutBack/cutBack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Help entry for where to save money", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); act(() => root.render(<HelpView />)); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const search = (words: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, words); input.dispatchEvent(new Event("input", { bubbles: true })); });
    return (container.textContent ?? "").replace(/\s+/g, " ");
  };

  it("is found by what a person would search for", () => {
    for (const words of ["save money", "cut back", "overspending"]) expect(search(words), words).toContain("Where can I save money?");
  });

  it("quotes questions Ask the Vault really answers", () => {
    search("save money");
    const quoted = [...container.querySelectorAll("q")].map(q => q.textContent ?? "").filter(text => /save money\?|cut back on\?/.test(text));
    expect(quoted).toEqual(["Where can I save money?", "What can I cut back on?"]);
    for (const text of quoted) expect(isCutBackQuestion(text), text).toBe(true);
  });

  it("says what is listed, what is left out, and that it is not advice", () => {
    const text = search("save money");
    for (const phrase of ["over budget this month", "higher than usual", "biggest flexible spending", "Fixed and Income budget groups are left out", "Try a what-if", "not advice", "nothing is changed"]) expect(text, phrase).toContain(phrase);
  });
});
