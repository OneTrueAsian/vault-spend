// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SidebarControls } from "./SidebarControls";
import type { Theme } from "./appTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SidebarControls", () => {
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

  function render(privacyHidden: boolean, theme: Theme) {
    const onTogglePrivacy = vi.fn();
    const onSetTheme = vi.fn();
    act(() =>
      root.render(
        <SidebarControls privacyHidden={privacyHidden} onTogglePrivacy={onTogglePrivacy} theme={theme} onSetTheme={onSetTheme} />,
      ),
    );
    return { onTogglePrivacy, onSetTheme };
  }
  const privacy = () => container.querySelector<HTMLButtonElement>("[data-privacy-toggle]")!;
  const themeButton = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>(".theme-toggle button")).find((b) => b.textContent === label)!;
  const cycle = () => container.querySelector<HTMLButtonElement>("button.theme-cycle[data-theme-cycle]")!;

  it("renders inside .sidebar-controls", () => {
    render(false, "dark");
    expect(container.querySelector(".sidebar-controls")).not.toBeNull();
  });

  it("shows Hide amounts while amounts are visible and toggles on click", () => {
    const { onTogglePrivacy } = render(false, "dark");
    expect(privacy().classList.contains("privacy-toggle")).toBe(true);
    expect(privacy().getAttribute("aria-pressed")).toBe("false");
    expect(privacy().textContent).toBe("Hide amounts");
    act(() => privacy().click());
    expect(onTogglePrivacy).toHaveBeenCalledTimes(1);
  });

  it("shows Show amounts while amounts are hidden", () => {
    render(true, "dark");
    expect(privacy().getAttribute("aria-pressed")).toBe("true");
    expect(privacy().textContent).toBe("Show amounts");
    expect(privacy().classList.contains("privacy-toggle-on")).toBe(true);
  });

  it("offers Light / Dark / System as a named group with the current one marked", () => {
    const { onSetTheme } = render(false, "dark");
    const group = container.querySelector(".theme-toggle")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Theme");
    expect(themeButton("Dark").classList.contains("theme-toggle-active")).toBe(true);
    expect(themeButton("Light").classList.contains("theme-toggle-active")).toBe(false);
    act(() => themeButton("Light").click());
    expect(onSetTheme).toHaveBeenCalledWith("light");
  });

  it("has a cycle button that moves to the next theme", () => {
    const { onSetTheme } = render(false, "dark");
    expect(cycle().getAttribute("aria-label")).toBe("Theme: Dark. Switch to System.");
    act(() => cycle().click());
    expect(onSetTheme).toHaveBeenCalledWith("system");
  });

  it.each([
    ["light", "dark", "Theme: Light. Switch to Dark."],
    ["dark", "system", "Theme: Dark. Switch to System."],
    ["system", "light", "Theme: System. Switch to Light."],
  ] as const)("cycles %s to %s", (from, to, label) => {
    const { onSetTheme } = render(false, from);
    expect(cycle().getAttribute("aria-label")).toBe(label);
    act(() => cycle().click());
    expect(onSetTheme).toHaveBeenCalledWith(to);
  });
});
