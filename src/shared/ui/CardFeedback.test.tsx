// @vitest-environment jsdom
// VS-71: a card repeats an action's result beside its button with the plain words only. The technical cause of a
// failure stays behind Details in the status line, so the card never shows it or the separator before it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CardFeedbackProvider, Feedback, useCardFeedback } from "./CardFeedback";
import { ERROR_DETAIL_SEPARATOR } from "../lib/errorMessage";

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
});

function Card() {
  const feedback = useCardFeedback("copy");
  return (
    <>
      <button type="button" onClick={feedback.begin}>Start copying</button>
      <Feedback text={feedback.text} kind={feedback.kind} />
    </>
  );
}

describe("CardFeedback (VS-71)", () => {
  it("repeats a failure's plain words without its technical cause", () => {
    const show = (status: { text: string; kind: string } | null) =>
      act(() => root.render(<CardFeedbackProvider status={status}><Card /></CardFeedbackProvider>));
    show(null);
    act(() => container.querySelector("button")!.click());
    show({ text: `Vault Spend can't save files in that folder.${ERROR_DETAIL_SEPARATOR}couldn't write to %USERPROFILE%\\x: Access is denied. (os error 5)`, kind: "error" });
    expect(container.querySelector(".settings-feedback")?.textContent).toBe("Vault Spend can't save files in that folder.");
  });
});
