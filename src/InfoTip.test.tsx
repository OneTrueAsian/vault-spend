// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InfoTip } from "./InfoTip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("InfoTip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const show = (props: Partial<React.ComponentProps<typeof InfoTip>> = {}) =>
    act(() => root.render(<InfoTip label="Annual spending" text="Your household's total spending for a year." {...props} />));
  const button = () => container.querySelector<HTMLButtonElement>("button")!;
  const tip = () => container.querySelector<HTMLElement>("[role='tooltip']")!;
  const isOpen = () => tip().dataset.open === "true";
  const hover = (over: boolean) =>
    act(() => {
      button().dispatchEvent(new MouseEvent(over ? "mouseover" : "mouseout", { bubbles: true, relatedTarget: document.body }));
    });

  it("is a labelled button whose text is always there for screen readers, closed at first", () => {
    show();
    expect(button().getAttribute("aria-label")).toBe("About Annual spending");
    expect(tip().textContent).toBe("Your household's total spending for a year.");
    expect(button().getAttribute("aria-describedby")).toBe(tip().id);
    expect(isOpen()).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });

  it("uses the id it is given, so a field can point at the same text", () => {
    show({ id: "spending-tip" });
    expect(tip().id).toBe("spending-tip");
    expect(button().getAttribute("aria-describedby")).toBe("spending-tip");
  });

  it("opens while hovered", () => {
    show();
    hover(true);
    expect(isOpen()).toBe(true);
    hover(false);
    expect(isOpen()).toBe(false);
  });

  it("opens while focused from the keyboard", () => {
    show();
    act(() => button().focus());
    expect(isOpen()).toBe(true);
    act(() => button().blur());
    expect(isOpen()).toBe(false);
  });

  it("stays open after a click (a tap on a touch screen) until clicked again", () => {
    show();
    act(() => button().click());
    hover(false);
    act(() => button().blur());
    expect(isOpen()).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    act(() => button().click());
    expect(isOpen()).toBe(false);
  });

  it("closes on a second click even with the pointer still over it and focus still on it", () => {
    show();
    hover(true);
    act(() => button().focus());
    act(() => button().click());
    expect(isOpen()).toBe(true);
    act(() => button().click());
    expect(isOpen()).toBe(false);
  });

  it("opens again when the pointer comes back after being closed by a click", () => {
    show();
    hover(true);
    act(() => button().click());
    act(() => button().click());
    hover(false);
    hover(true);
    expect(isOpen()).toBe(true);
  });

  it("closes on Escape without letting the key reach a dialog around it", () => {
    // ModalShell listens for Escape on the document, which is where this checks.
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    show();
    act(() => button().click());
    act(() => {
      button().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(isOpen()).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outer);
  });

  it("lets Escape through when it is already closed", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    show();
    act(() => {
      button().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", outer);
  });

  it("closes a clicked-open tip when you click somewhere else", () => {
    show();
    act(() => button().click());
    act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(isOpen()).toBe(false);
  });

  it("never submits a form it sits in", () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    act(() =>
      root.render(
        <form onSubmit={(e) => submit(e.nativeEvent)}>
          <InfoTip label="Age" text="Used to pick the age group." />
        </form>,
      ),
    );
    act(() => button().click());
    expect(submit).not.toHaveBeenCalled();
  });
});
