import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom has no layout: give every element a real-looking box so a calendar does not think its field vanished. */
export function mockLayout() {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return { x: 100, y: 100, left: 100, top: 100, right: 300, bottom: 136, width: 200, height: 36, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** Mounts what a test renders into the document and tears it down after each test. */
export function useHost() {
  const state = {} as { container: HTMLDivElement; root: Root; render: (ui: ReactElement) => void };
  let restoreLayout = () => {};
  beforeEach(() => {
    restoreLayout = mockLayout();
    state.container = document.createElement("div");
    document.body.append(state.container);
    state.root = createRoot(state.container);
    state.render = (ui) => act(() => state.root.render(ui));
  });
  afterEach(() => {
    act(() => state.root.unmount());
    state.container.remove();
    restoreLayout();
    vi.useRealTimers();
  });
  return state;
}

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

/** Types into a React-controlled input the way a person does: one input event with the whole new text. */
export function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    valueSetter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function key(target: Element, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

export function click(target: Element) {
  act(() => {
    (target as HTMLElement).click();
  });
}

export function focus(target: HTMLElement) {
  act(() => target.focus());
}

export function blurTo(from: HTMLElement, to: HTMLElement | null) {
  act(() => {
    if (to) to.focus();
    else from.blur();
  });
}
