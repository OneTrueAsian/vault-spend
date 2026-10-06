// @vitest-environment jsdom
//
// The one date field: a real date input underneath (so typing and the calendar still work), showing
// "Oct 4, 2026" while it isn't being edited.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DateField } from "./DateField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DateField", () => {
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

  const input = () => container.querySelector<HTMLInputElement>("input")!;
  const text = () => container.querySelector(".date-field-text")!;

  it("is a real date input, shown as a written-out date", () => {
    act(() => root.render(<DateField value="2026-10-04" onChange={() => {}} ariaLabel="Date" />));
    const el = container.querySelector<HTMLInputElement>('input[type="date"][aria-label="Date"]');
    expect(el).not.toBeNull();
    expect(el!.value).toBe("2026-10-04");
    expect(text().textContent).toBe("Oct 4, 2026");
    expect(text().getAttribute("aria-hidden")).toBe("true");
  });

  it("always names the year, even for this year", () => {
    const thisYear = new Date().getFullYear();
    act(() => root.render(<DateField value={`${thisYear}-03-15`} onChange={() => {}} ariaLabel="Date" />));
    expect(text().textContent).toBe(`Mar 15, ${thisYear}`);
  });

  it("reports a new date as a stored date", () => {
    const onChange = vi.fn();
    act(() => root.render(<DateField value="2026-10-04" onChange={onChange} ariaLabel="Date" />));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input(), "2026-10-05");
      input().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("2026-10-05");
  });

  it("asks for a date when it's empty, or shows the given hint", () => {
    act(() => root.render(<DateField value="" onChange={() => {}} ariaLabel="Date" />));
    expect(text().textContent).toBe("Pick a date");
    expect(container.querySelector(".date-field")!.classList.contains("date-field-empty")).toBe(true);
    act(() => root.render(<DateField value="" onChange={() => {}} ariaLabel="Date" placeholder="Any date" />));
    expect(text().textContent).toBe("Any date");
  });

  it("shows the real input while it has focus, and passes focus and keys on", () => {
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();
    act(() => root.render(<DateField value="2026-10-04" onChange={() => {}} ariaLabel="Date" onBlur={onBlur} onKeyDown={onKeyDown} />));
    const wrapper = container.querySelector(".date-field")!;
    expect(wrapper.classList.contains("date-field-editing")).toBe(false);
    act(() => input().focus());
    expect(wrapper.classList.contains("date-field-editing")).toBe(true);
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    act(() => input().blur());
    expect(wrapper.classList.contains("date-field-editing")).toBe(false);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("starts in editing mode when it takes focus on mount", () => {
    act(() => root.render(<DateField value="2026-10-04" onChange={() => {}} ariaLabel="Date" autoFocus />));
    expect(document.activeElement).toBe(input());
    expect(container.querySelector(".date-field")!.classList.contains("date-field-editing")).toBe(true);
  });

  it("passes the input's own class, id, limits, title, data attributes and disabled state through", () => {
    act(() =>
      root.render(
        <DateField
          value="2026-10-04"
          onChange={() => {}}
          ariaLabel="Statement ending date"
          className="row-edit-input"
          id="stmt"
          min="2026-01-01"
          max="2026-12-31"
          title="Statement ending date"
          disabled
          ariaDescribedBy="tip"
          data-statement-date=""
        />,
      ),
    );
    const el = input();
    expect(el.classList.contains("row-edit-input")).toBe(true);
    expect(el.classList.contains("date-field-input")).toBe(true);
    expect(el.id).toBe("stmt");
    expect(el.min).toBe("2026-01-01");
    expect(el.max).toBe("2026-12-31");
    expect(el.title).toBe("Statement ending date");
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("aria-describedby")).toBe("tip");
    expect(el.hasAttribute("data-statement-date")).toBe(true);
    expect(container.querySelector(".date-field")!.classList.contains("date-field-disabled")).toBe(true);
  });
});
