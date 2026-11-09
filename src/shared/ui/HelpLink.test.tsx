// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpLink } from "./HelpLink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("HelpLink", () => {
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

  it("is a ? button named after its page that opens that page's help", () => {
    const onOpen = vi.fn();
    act(() => root.render(<HelpLink tab="buckets" onOpen={onOpen} />));
    const button = container.querySelector<HTMLButtonElement>("button.help-link")!;
    expect(button.textContent).toBe("?");
    expect(button.getAttribute("aria-label")).toBe("Help for Goals");
    expect(button.type).toBe("button");
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledWith("buckets");
  });
});
