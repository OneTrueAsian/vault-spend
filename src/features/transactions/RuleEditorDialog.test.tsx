// @vitest-environment jsdom
//
// New / edit rule (VS-49): Save rule says what is still missing instead of only being greyed out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { RuleEditorDialog } from "./RuleEditorDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const type = (input: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const note = () => document.querySelector("[data-rule-missing]")?.textContent ?? null;
const save = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save rule")!;

describe("RuleEditorDialog says what is missing (VS-49)", () => {
  it("asks for the text, then the category, then lets Save rule through", () => {
    const onSubmit = vi.fn();
    act(() =>
      root.render(
        <RuleEditorDialog
          categories={["Coffee"]}
          initial={null}
          onPreview={async () => ({ matching: 0, would_change: 0 })}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      ),
    );
    expect(save().disabled).toBe(true);
    expect(note()).toBe("Enter the text to look for.");
    type(document.querySelector<HTMLInputElement>('input[placeholder^="e.g."]')!, "Ferrywood");
    expect(save().disabled).toBe(true);
    expect(note()).toBe("Pick a category.");
    type(document.querySelector<HTMLInputElement>('input[aria-label="Give it this category"]')!, "Coffee");
    expect(note()).toBeNull();
    expect(save().disabled).toBe(false);
    act(() => save().click());
    expect(onSubmit).toHaveBeenCalledWith("Ferrywood", "Coffee", false);
  });
});
