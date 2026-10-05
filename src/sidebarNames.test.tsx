// @vitest-environment jsdom
// Review Focus 1: below 1000px the sidebar shows icons only. Each tab must keep its name for screen
// readers and for the E2E text selectors (`button*=Settings`), so the name is an aria-label and the
// visible text is hidden with the visually-hidden pattern, never `display: none`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { SidebarNav } from "./SidebarNav";
import { NAV_ITEMS, PINNED_NAV_ITEMS } from "./appTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SidebarNav names", () => {
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

  function render(onSelect = vi.fn()) {
    act(() =>
      root.render(
        <SidebarNav
          items={NAV_ITEMS}
          activeTab="dashboard"
          dragNavTab={null}
          onSelect={onSelect}
          onDragStartItem={vi.fn()}
          onDragEndItem={vi.fn()}
          onDropItem={vi.fn()}
          onMoveItem={vi.fn()}
        />,
      ),
    );
    return onSelect;
  }

  it("gives every nav button its name as aria-label and its id as data-tab", () => {
    render();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button.nav-item")];
    const expected = [...NAV_ITEMS, ...PINNED_NAV_ITEMS];
    expect(buttons).toHaveLength(expected.length);
    for (const item of expected) {
      const button = container.querySelector<HTMLButtonElement>(`button.nav-item[data-tab="${item.id}"]`);
      expect(button, item.id).not.toBeNull();
      expect(button!.getAttribute("aria-label")).toBe(item.label);
    }
  });

  it("keeps the visible name in a .nav-text span that is never hidden inline", () => {
    render();
    for (const button of container.querySelectorAll<HTMLButtonElement>("button.nav-item")) {
      const text = button.querySelector<HTMLSpanElement>("span.nav-text");
      expect(text, button.dataset.tab).not.toBeNull();
      expect(text!.textContent).toBe(button.getAttribute("aria-label"));
      expect(text!.style.display).not.toBe("none");
    }
  });

  it("reports the chosen tab", () => {
    const onSelect = render();
    act(() => container.querySelector<HTMLButtonElement>('button.nav-item[data-tab="settings"]')!.click());
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("never hides .nav-text with display: none in the narrow layout", () => {
    const css = fs.readFileSync(path.join(__dirname, "AppResponsive.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const hiding = rules.filter(([, selector, body]) => selector.includes("nav-text") && /display\s*:\s*none/.test(body));
    expect(hiding.map(([, selector]) => selector.trim())).toEqual([]);
    const visuallyHidden = rules.find(([, selector, body]) => selector.includes("nav-text") && /clip-path\s*:\s*inset\(50%\)/.test(body));
    expect(visuallyHidden, "the .nav-text rule should use the visually-hidden pattern").toBeDefined();
  });
});
