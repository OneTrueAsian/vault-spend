// @vitest-environment jsdom
//
// MenuSelect: the popover-menu single select the filter dropdowns use, for places that were still a
// native <select> (whose open list the OS draws and the app's themes cannot style).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MenuSelect } from "./MenuSelect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: "default", label: "Default" },
  { value: "bills", label: "Bills Focus" },
  { value: "custom:Weekly", label: "Weekly check-in" },
  { value: "custom", label: "Custom (unsaved)", disabled: true },
];

describe("MenuSelect", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(value: string) {
    act(() => {
      root.render(<MenuSelect ariaLabel="Dashboard layout" options={OPTIONS} value={value} onChange={onChange} triggerClassName="layout-select-toggle" />);
    });
  }

  const trigger = () => container.querySelector<HTMLButtonElement>(".layout-select-toggle")!;
  const openMenu = () => act(() => trigger().click());
  const item = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find((b) => b.textContent?.includes(label))!;

  it("shows the selected option's label and exposes its value on the trigger", () => {
    show("bills");

    expect(trigger().textContent).toContain("Bills Focus");
    expect(trigger().dataset.value).toBe("bills");
  });

  it("names the control for assistive technology, including what is selected", () => {
    show("default");

    expect(trigger().getAttribute("aria-label")).toBe("Dashboard layout: Default");
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
  });

  it("opens a menu of every option with the current one checked", () => {
    show("bills");
    openMenu();

    expect(container.querySelectorAll("[role='menuitemradio']")).toHaveLength(4);
    expect(item("Bills Focus").getAttribute("aria-checked")).toBe("true");
    expect(item("Default").getAttribute("aria-checked")).toBe("false");
  });

  it("reports the chosen value and closes the menu", () => {
    show("default");
    openMenu();

    act(() => item("Weekly check-in").click());

    expect(onChange).toHaveBeenCalledWith("custom:Weekly");
    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("shows a disabled option that cannot be chosen", () => {
    show("custom");
    openMenu();

    expect(item("Custom (unsaved)").disabled).toBe(true);
    act(() => item("Custom (unsaved)").click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("arrow keys skip a disabled option, wrapping from the last choosable one back to the first", () => {
    show("custom:Weekly");
    openMenu();
    const last = item("Weekly check-in");
    expect(document.activeElement).toBe(last);

    act(() => {
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    expect(document.activeElement).toBe(item("Default"));
  });

  it("stays open when the page scrolls after it opens (a click can scroll its own trigger into view)", () => {
    show("default");
    openMenu();

    act(() => {
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(container.querySelector("[role='menu']")).not.toBeNull();
  });

  it("closes on Escape without changing anything", () => {
    show("default");
    openMenu();

    act(() => {
      // The menu owns focus once open, so Escape arrives from inside it.
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the raw value when it matches no option", () => {
    show("gone");

    expect(trigger().textContent).toContain("gone");
  });

  it("shows the placeholder, and names the control by its own label, while the value is empty", () => {
    act(() => {
      root.render(<MenuSelect ariaLabel="Set category to…" placeholder="Set category to…" options={OPTIONS} value="" onChange={onChange} triggerClassName="t" />);
    });
    const t = container.querySelector<HTMLButtonElement>(".t")!;

    expect(t.textContent).toContain("Set category to…");
    expect(t.getAttribute("aria-label")).toBe("Set category to…");
    expect(t.classList.contains("menu-select-placeholder")).toBe(true);
  });

  it("prefers a real option over the placeholder when the empty value is one of the options", () => {
    act(() => {
      root.render(<MenuSelect ariaLabel="Member" placeholder="nothing" options={[{ value: "", label: "Unassigned" }]} value="" onChange={onChange} triggerClassName="t" />);
    });

    expect(container.querySelector(".t")!.textContent).toContain("Unassigned");
  });

  it("puts a heading above each run of grouped options", () => {
    act(() => {
      root.render(
        <MenuSelect
          ariaLabel="Import"
          value="skip"
          onChange={onChange}
          triggerClassName="t"
          options={[
            { value: "skip", label: "Don't use it" },
            { value: "map:A", label: "A", group: "Use one of my categories" },
            { value: "map:B", label: "B", group: "Use one of my categories" },
          ]}
        />,
      );
    });
    act(() => container.querySelector<HTMLButtonElement>(".t")!.click());

    const headings = [...container.querySelectorAll(".menu-select-group")].map((h) => h.textContent);
    expect(headings).toEqual(["Use one of my categories"]);
  });

  it("passes extra attributes through to the trigger", () => {
    act(() => {
      root.render(<MenuSelect ariaLabel="x" options={OPTIONS} value="default" onChange={onChange} triggerClassName="t" triggerAttrs={{ "data-hook": "yes" }} />);
    });

    expect(container.querySelector<HTMLButtonElement>(".t")!.dataset.hook).toBe("yes");
  });

  it("does not open when disabled", () => {
    act(() => {
      root.render(<MenuSelect ariaLabel="x" options={OPTIONS} value="default" onChange={onChange} triggerClassName="t" disabled />);
    });
    act(() => container.querySelector<HTMLButtonElement>(".t")!.click());

    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("fills its container when asked, and is inline otherwise", () => {
    act(() => {
      root.render(<MenuSelect ariaLabel="x" options={OPTIONS} value="default" onChange={onChange} fill />);
    });
    expect(container.querySelector(".menu-select")!.classList.contains("menu-select-fill")).toBe(true);
    show("default");
    expect(container.querySelector(".menu-select")!.classList.contains("menu-select-fill")).toBe(false);
  });
});
