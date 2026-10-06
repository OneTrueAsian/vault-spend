// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveTheme, useResolvedTheme } from "./useResolvedTheme";
import type { Theme } from "./appTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("resolveTheme", () => {
  it("keeps an explicit choice and follows the system for System", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("useResolvedTheme", () => {
  let container: HTMLDivElement;
  let root: Root;
  let listeners: ((e: { matches: boolean }) => void)[];
  let systemDark: boolean;

  beforeEach(() => {
    listeners = [];
    systemDark = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        media: query,
        get matches() {
          return systemDark;
        },
        addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l),
        removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => (listeners = listeners.filter((x) => x !== l)),
      })),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Probe({ theme }: { theme: Theme }) {
    return <span>{useResolvedTheme(theme)}</span>;
  }

  it("follows the system's light or dark while System is chosen, and updates when it changes", () => {
    act(() => root.render(<Probe theme="system" />));
    expect(container.textContent).toBe("light");
    systemDark = true;
    act(() => listeners.forEach((l) => l({ matches: true })));
    expect(container.textContent).toBe("dark");
    act(() => root.render(<Probe theme="light" />));
    expect(container.textContent).toBe("light");
  });
});
