// @vitest-environment jsdom
//
// ModalShell behaviour shared by every dialog. Each feature dialog's own tests sit beside it in its feature folder.
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ModalShell } from "./Modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("Escape dismisses only the upper confirmation and leaves the unsaved dialog intact", () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), lower = vi.fn(), upper = vi.fn();
  act(() => root.render(<><ModalShell title="Draft" onCancel={lower}><input defaultValue="unsaved" /></ModalShell>
    <ModalShell title="Lock?" onCancel={upper}><button autoFocus>Keep editing</button></ModalShell></>));
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(upper).toHaveBeenCalledOnce(); expect(lower).not.toHaveBeenCalled();
  expect(document.querySelector("input")!.value).toBe("unsaved");
  act(() => root.unmount()); container.remove();
});

// Continuation 12 matrix (L03): in "Import holdings" the focused "Match columns" button is replaced by "Review holdings" on the next step.
// The focused button was disabled while the rows were checked, then replaced, so focus sat on <body>, behind the overlay, until the next Tab. The dialog must keep focus inside itself.
describe("ModalShell keeps focus inside when the focused control disappears on a step change", () => {
  it("moves focus to the panel instead of leaving it on the page behind", () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    function Stepper() {
      const [step, setStep] = React.useState(1);
      return <ModalShell title="Steps" onCancel={() => {}}>
        {step === 1 ? <button id="first" onClick={() => setStep(2)}>Match columns</button> : <button id="second">Review holdings</button>}
      </ModalShell>;
    }
    act(() => root.render(<Stepper />));
    const first = document.getElementById("first") as HTMLButtonElement;
    act(() => first.focus());
    expect(document.activeElement).toBe(first);
    // Chromium drops focus to <body> when the focused button is disabled (the dialog disables it while it works); jsdom does not, so say so.
    act(() => first.blur());
    expect(document.activeElement).toBe(document.body);
    act(() => first.click());
    expect(document.getElementById("second")).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
    act(() => root.unmount()); container.remove();
  });
});
