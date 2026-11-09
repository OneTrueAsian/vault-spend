// @vitest-environment jsdom
//
// Until the profile's data has arrived, views used to render their empty states ("No transactions yet",
// "No accounts yet"), which on a large profile looked like the data was gone (2026-10-02 QA, H3). The
// placeholder shown instead stays blank for a moment, so a quick load doesn't flash a message.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DataLoading } from "./DataLoading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<DataLoading />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("DataLoading", () => {
  it("is a busy status region from the start, with no text during a quick load", () => {
    const region = host.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-busy")).toBe("true");
    act(() => vi.advanceTimersByTime(250));
    expect(region!.textContent).toBe("");
  });

  it("says what it is loading once the load takes a moment", () => {
    act(() => vi.advanceTimersByTime(350));
    expect(host.textContent).toContain("Loading your accounts and transactions…");
    expect(host.textContent).not.toMatch(/No transactions|No accounts/);
  });
});
