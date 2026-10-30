// @vitest-environment jsdom
//
// The calendars drawn by the app for DateField and MonthField: opening, focus, keyboard, bounds, the
// month-and-year jump, ownership (one open at a time) and teardown.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { DateField } from "../DateField";
import { MonthField } from "../MonthField";
import { blurTo, click, focus, key, typeInto, useHost } from "./calendarTestUtils";

const TODAY = new Date(2026, 9, 29, 12, 0, 0); // Thursday 29 October 2026, local time

describe("date calendar", () => {
  const host = useHost();
  const q = <T extends Element = HTMLElement>(selector: string) => host.container.querySelector<T>(selector);
  const input = () => q<HTMLInputElement>("input")!;
  const trigger = () => q<HTMLButtonElement>(".date-field-trigger")!;
  const panel = () => q<HTMLElement>('[role="dialog"]');
  const day = (iso: string) => q<HTMLButtonElement>(`[data-date="${iso}"]`)!;
  const heading = () => q(".calendar-heading")!.textContent!.trim();
  const field = (props: Partial<React.ComponentProps<typeof DateField>> = {}) =>
    host.render(<DateField value="2026-10-15" onChange={() => {}} ariaLabel="Date" locale="en-US" {...props} />);
  const open = () => click(trigger());
  const fakeNow = () => vi.useFakeTimers({ toFake: ["Date"], now: TODAY });

  it("opens a non-modal dialog on the chosen day, named by its heading", () => {
    fakeNow();
    field();
    expect(panel()).toBeNull();
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    open();
    const dialog = panel()!;
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe(q(".calendar-heading")!.id);
    expect(dialog.getAttribute("aria-describedby")).toBe(q(".calendar-help")!.id);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(dialog.id);
    expect(heading()).toContain("October 2026");
    expect(document.activeElement).toBe(day("2026-10-15"));
    expect(day("2026-10-15").closest('[role="gridcell"]')!.getAttribute("aria-selected")).toBe("true");
    expect(day("2026-10-29").getAttribute("aria-current")).toBe("date");
    expect(day("2026-10-15").getAttribute("aria-label")).toBe("Thursday, October 15, 2026");
  });

  it("draws six weeks of seven days starting on the region's first weekday, with one tab stop", () => {
    field();
    open();
    expect(host.container.querySelectorAll("[data-date]")).toHaveLength(42);
    const headers = [...host.container.querySelectorAll("thead th")].map((th) => th.getAttribute("abbr"));
    expect(headers[0]).toBe("Sunday");
    expect(host.container.querySelectorAll('[data-date][tabindex="0"]')).toHaveLength(1);
    field({ locale: "en-GB" });
    expect([...host.container.querySelectorAll("thead th")][0].getAttribute("abbr")).toBe("Monday");
  });

  it("names adjacent-month days in full and lets them be chosen", () => {
    const onChange = vi.fn();
    field({ onChange });
    open();
    const outside = day("2026-09-30");
    expect(outside.classList.contains("is-outside")).toBe(true);
    expect(outside.getAttribute("aria-label")).toBe("Wednesday, September 30, 2026");
    click(outside);
    expect(onChange).toHaveBeenCalledWith("2026-09-30");
  });

  it("choosing a day reports it once, closes, and puts focus back in the box", () => {
    const onChange = vi.fn();
    field({ onChange });
    open();
    click(day("2026-10-20"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-10-20");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe("10/20/2026");
  });

  it("choosing the day already chosen reports nothing new", () => {
    const onChange = vi.fn();
    field({ onChange });
    open();
    click(day("2026-10-15"));
    expect(onChange).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it("replaces unfinished text when a day is chosen, and clears the error", () => {
    const onChange = vi.fn();
    field({ onChange });
    focus(input());
    typeInto(input(), "10/0");
    open();
    click(day("2026-10-02"));
    expect(onChange).toHaveBeenCalledWith("2026-10-02");
    expect(input().value).toBe("10/02/2026");
    expect(q(".date-field-problem")).toBeNull();
  });

  describe("Escape", () => {
    for (const origin of ["panel", "input", "trigger"] as const) {
      it(`closes only the calendar when pressed in the ${origin}, and nothing around it sees the key`, () => {
        const outer = vi.fn();
        document.addEventListener("keydown", outer);
        const onChange = vi.fn();
        field({ onChange });
        open();
        const target = origin === "panel" ? day("2026-10-15") : origin === "input" ? input() : trigger();
        const event = key(target, "Escape");
        document.removeEventListener("keydown", outer);
        expect(panel()).toBeNull();
        expect(event.defaultPrevented).toBe(true);
        expect(outer).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger());
      });
    }

    it("returns focus to the box when the calendar was opened from it", () => {
      field();
      focus(input());
      key(input(), "ArrowDown", { altKey: true });
      expect(panel()).not.toBeNull();
      key(day("2026-10-15"), "Escape");
      expect(document.activeElement).toBe(input());
    });
  });

  describe("keyboard", () => {
    const focused = () => (document.activeElement as HTMLElement).getAttribute("data-date");

    it("moves focus a day, a week, a month and a year without choosing anything", () => {
      const onChange = vi.fn();
      field({ onChange });
      open();
      key(day("2026-10-15"), "ArrowRight");
      expect(focused()).toBe("2026-10-16");
      key(document.activeElement!, "ArrowLeft");
      key(document.activeElement!, "ArrowLeft");
      expect(focused()).toBe("2026-10-14");
      key(document.activeElement!, "ArrowDown");
      expect(focused()).toBe("2026-10-21");
      key(document.activeElement!, "ArrowUp");
      key(document.activeElement!, "ArrowUp");
      expect(focused()).toBe("2026-10-07");
      key(document.activeElement!, "PageDown");
      expect(focused()).toBe("2026-11-07");
      expect(heading()).toContain("November 2026");
      key(document.activeElement!, "PageUp");
      key(document.activeElement!, "PageUp");
      expect(heading()).toContain("September 2026");
      key(document.activeElement!, "PageDown", { shiftKey: true });
      expect(focused()).toBe("2027-09-07");
      key(document.activeElement!, "PageUp", { shiftKey: true });
      expect(focused()).toBe("2026-09-07");
      expect(onChange).not.toHaveBeenCalled();
      expect(panel()).not.toBeNull();
    });

    it("goes to the ends of the week the region shows", () => {
      field();
      open();
      key(day("2026-10-15"), "Home");
      expect(focused()).toBe("2026-10-11");
      key(document.activeElement!, "End");
      expect(focused()).toBe("2026-10-17");
      key(document.activeElement!, "Escape");
      field({ locale: "en-GB" });
      open();
      key(day("2026-10-15"), "Home");
      expect(focused()).toBe("2026-10-12");
      key(document.activeElement!, "End");
      expect(focused()).toBe("2026-10-18");
    });

    it("shortens the day at the end of a shorter month, and across leap years", () => {
      field({ value: "2026-01-31" });
      open();
      key(day("2026-01-31"), "PageDown");
      expect(focused()).toBe("2026-02-28");
      key(document.activeElement!, "Escape");
      field({ value: "2024-02-29" });
      open();
      key(day("2024-02-29"), "PageDown", { shiftKey: true });
      expect(focused()).toBe("2025-02-28");
      key(document.activeElement!, "PageDown", { shiftKey: true, });
      key(document.activeElement!, "PageDown", { shiftKey: true });
      key(document.activeElement!, "PageDown", { shiftKey: true });
      expect(focused()).toBe("2028-02-28");
    });

    it("follows the visual direction in a right-to-left region", () => {
      field({ locale: "ar-EG" });
      open();
      expect(panel()!.getAttribute("dir")).toBe("rtl");
      key(day("2026-10-15"), "ArrowRight");
      expect(focused()).toBe("2026-10-14");
      key(document.activeElement!, "ArrowLeft");
      expect(focused()).toBe("2026-10-15");
    });

    it("keeps the grid keys to itself and leaves other keys alone", () => {
      field();
      open();
      expect(key(day("2026-10-15"), "ArrowRight").defaultPrevented).toBe(true);
      expect(key(document.activeElement!, "a").defaultPrevented).toBe(false);
    });
  });

  describe("limits", () => {
    it("lets only days inside the limits be chosen, and the limits are inclusive", () => {
      const onChange = vi.fn();
      field({ onChange, min: "2026-10-10", max: "2026-10-20" });
      open();
      expect(day("2026-10-09").disabled).toBe(true);
      expect(day("2026-10-10").disabled).toBe(false);
      expect(day("2026-10-20").disabled).toBe(false);
      expect(day("2026-10-21").disabled).toBe(true);
      expect(day("2026-10-21").classList.contains("is-unavailable")).toBe(true);
      click(day("2026-10-21"));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("cannot move past a limit with the keyboard, and disables paging beyond it", () => {
      field({ min: "2026-10-10", max: "2026-10-20" });
      open();
      key(day("2026-10-15"), "PageDown");
      expect((document.activeElement as HTMLElement).getAttribute("data-date")).toBe("2026-10-20");
      key(document.activeElement!, "ArrowRight");
      expect((document.activeElement as HTMLElement).getAttribute("data-date")).toBe("2026-10-20");
      expect(q<HTMLButtonElement>('[aria-label="Next month"]')!.disabled).toBe(true);
      expect(q<HTMLButtonElement>('[aria-label="Previous month"]')!.disabled).toBe(true);
    });

    it("opens a saved date that is out of range on the nearest day that can be chosen, and leaves the value alone", () => {
      const onChange = vi.fn();
      fakeNow();
      field({ onChange, value: "2026-01-15", min: "2026-10-01" });
      open();
      expect(heading()).toContain("October 2026");
      expect(document.activeElement).toBe(day("2026-10-29"));
      expect(onChange).not.toHaveBeenCalled();
      expect(input().value).toBe("01/15/2026");
    });

    it("never clamps Today into range: it is simply unavailable", () => {
      fakeNow();
      field({ min: "2026-11-05" });
      open();
      const today = [...host.container.querySelectorAll<HTMLButtonElement>(".calendar-action")].find((b) => b.textContent === "Today")!;
      expect(today.disabled).toBe(true);
    });

    it("shows no selectable day when the limits leave nothing, and says why", () => {
      field({ min: "2026-10-05", max: "2026-10-04" });
      open();
      expect(host.container.querySelectorAll("[data-date]:not(:disabled)")).toHaveLength(0);
      expect(q(".date-field-problem")?.textContent).toBe("No dates can be chosen here.");
      expect(panel()).not.toBeNull();
    });
  });

  describe("month and year jump", () => {
    it("opens a month grid from the heading, and picking a month only changes the month browsed", () => {
      const onChange = vi.fn();
      field({ onChange });
      open();
      click(q(".calendar-jump")!);
      expect(q('input[aria-label="Year"]')).not.toBeNull();
      expect(host.container.querySelectorAll(".calendar-month")).toHaveLength(12);
      click([...host.container.querySelectorAll<HTMLButtonElement>(".calendar-month")].find((b) => b.textContent === "Mar")!);
      expect(heading()).toContain("March 2026");
      expect(host.container.querySelector("[data-date]")).not.toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(panel()).not.toBeNull();
    });

    it("goes back to the days without picking, and never opens a second popup", () => {
      field();
      open();
      click(q(".calendar-jump")!);
      click([...host.container.querySelectorAll<HTMLButtonElement>(".calendar-action")].find((b) => b.textContent === "Back to days")!);
      expect(heading()).toContain("October 2026");
      expect(host.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    });
  });

  describe("Clear and Today", () => {
    const action = (name: string) => [...host.container.querySelectorAll<HTMLButtonElement>(".calendar-action")].find((b) => b.textContent === name);

    it("an optional field offers Clear: it reports an empty value once, closes and returns focus", () => {
      const onChange = vi.fn();
      field({ onChange });
      open();
      click(action("Clear")!);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("");
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(input());
    });

    it("a required field offers no Clear", () => {
      field({ required: true });
      open();
      expect(action("Clear")).toBeUndefined();
    });

    it("Today chooses today's date", () => {
      fakeNow();
      const onChange = vi.fn();
      field({ onChange });
      open();
      click(action("Today")!);
      expect(onChange).toHaveBeenCalledWith("2026-10-29");
    });
  });

  it("closes when the caller replaces the date with one the field did not just report", () => {
    field();
    open();
    key(day("2026-10-15"), "PageDown");
    field({ value: "2027-02-03" });
    expect(panel()).toBeNull();
    expect(input().value).toBe("02/03/2027");
  });

  it("stays open while the caller only echoes the date the field just reported", () => {
    let value = "2026-10-15";
    const onChange = (iso: string) => {
      value = iso;
      field({ value, onChange });
    };
    field({ value, onChange });
    focus(input());
    typeInto(input(), "10/16/2026");
    open();
    expect(panel()).not.toBeNull();
    expect(value).toBe("2026-10-16");
  });

  describe("ownership and teardown", () => {
    it("only one field's calendar is open at a time", () => {
      host.render(
        <>
          <DateField value="2026-10-15" onChange={() => {}} ariaLabel="From" locale="en-US" />
          <DateField value="2026-11-15" onChange={() => {}} ariaLabel="To" locale="en-US" />
        </>,
      );
      const [first, second] = host.container.querySelectorAll<HTMLButtonElement>(".date-field-trigger");
      click(first);
      expect(host.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      click(second);
      const dialogs = host.container.querySelectorAll('[role="dialog"]');
      expect(dialogs).toHaveLength(1);
      expect(second.getAttribute("aria-expanded")).toBe("true");
      expect(first.getAttribute("aria-expanded")).toBe("false");
    });

    it("a press outside closes it and leaves focus where the person pressed", () => {
      const outside = document.createElement("button");
      document.body.append(outside);
      field();
      open();
      act(() => {
        outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      expect(panel()).toBeNull();
      act(() => outside.focus());
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it("tabbing out of the field closes it and does not take focus back", () => {
      const outside = document.createElement("button");
      document.body.append(outside);
      field();
      open();
      blurTo(day("2026-10-15"), outside);
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it("moving between the calendar's own controls is not leaving", () => {
      const onBlur = vi.fn();
      field({ onBlur });
      open();
      blurTo(day("2026-10-15"), q<HTMLElement>(".calendar-nav")!);
      expect(panel()).not.toBeNull();
      expect(onBlur).not.toHaveBeenCalled();
    });

    it("goes away cleanly when the field is removed while open", () => {
      field();
      open();
      expect(() => host.render(<div />)).not.toThrow();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("closes when the field becomes disabled", () => {
      field();
      open();
      field({ disabled: true });
      expect(panel()).toBeNull();
    });

    it("renders no second control for tests to find: one box and one button", () => {
      field();
      expect(host.container.querySelectorAll("input")).toHaveLength(1);
      expect(host.container.querySelectorAll("button")).toHaveLength(1);
    });
  });

  it("moves today along after midnight while the calendar is open", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 29, 23, 59, 0) });
    field();
    open();
    expect(day("2026-10-29").getAttribute("aria-current")).toBe("date");
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(day("2026-10-30").getAttribute("aria-current")).toBe("date");
    expect(day("2026-10-29").getAttribute("aria-current")).toBeNull();
  });
});

describe("month calendar", () => {
  const host = useHost();
  const q = <T extends Element = HTMLElement>(selector: string) => host.container.querySelector<T>(selector);
  const trigger = () => q<HTMLButtonElement>(".date-field-trigger")!;
  const input = () => q<HTMLInputElement>("input.date-field-input")!;
  const month = (y: number, m: number) => q<HTMLButtonElement>(`[data-month="${y}-${m}"]`)!;
  const field = (props: Partial<React.ComponentProps<typeof MonthField>> = {}) =>
    host.render(<MonthField value="2026-10" onChange={() => {}} aria-label="Withdraw month" locale="en-US" {...props} />);

  it("is a text box in the region's order and shows the month written out", () => {
    field();
    expect(input().type).toBe("text");
    expect(input().value).toBe("10/2026");
    expect(q(".date-field-text")!.textContent).toBe("Oct 2026");
    expect(host.container.querySelectorAll('input[type="month"]')).toHaveLength(0);
    field({ locale: "ja-JP" });
    expect(input().value).toBe("2026/10");
  });

  it("opens twelve months in four rows of three, focused on the chosen month", () => {
    field();
    click(trigger());
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(host.container.querySelectorAll(".calendar-month")).toHaveLength(12);
    expect(host.container.querySelectorAll(".calendar-month-row")).toHaveLength(4);
    expect(document.activeElement).toBe(month(2026, 10));
    expect(month(2026, 10).closest('[role="gridcell"]')!.getAttribute("aria-selected")).toBe("true");
    expect(month(2026, 10).getAttribute("aria-label")).toBe("October 2026");
  });

  it("choosing a month reports it once and closes with focus back in the box", () => {
    const onChange = vi.fn();
    field({ onChange });
    click(trigger());
    click(month(2026, 3));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-03");
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("moves by a month, a row, the ends of the year and whole years, choosing nothing", () => {
    const onChange = vi.fn();
    field({ onChange });
    click(trigger());
    const focused = () => (document.activeElement as HTMLElement).getAttribute("data-month");
    key(month(2026, 10), "ArrowLeft");
    expect(focused()).toBe("2026-9");
    key(document.activeElement!, "ArrowDown");
    expect(focused()).toBe("2026-12");
    key(document.activeElement!, "ArrowRight");
    expect(focused()).toBe("2027-1");
    key(document.activeElement!, "End");
    expect(focused()).toBe("2027-12");
    key(document.activeElement!, "Home");
    expect(focused()).toBe("2027-1");
    key(document.activeElement!, "PageUp");
    expect(focused()).toBe("2026-1");
    key(document.activeElement!, "PageDown");
    key(document.activeElement!, "PageDown");
    expect(focused()).toBe("2028-1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("follows the visual direction in a right-to-left region", () => {
    field({ locale: "ar-EG" });
    click(trigger());
    key(month(2026, 10), "ArrowRight");
    expect((document.activeElement as HTMLElement).getAttribute("data-month")).toBe("2026-9");
  });

  it("respects the limits: unavailable months are disabled and the keys stop at them", () => {
    field({ min: "2026-10", max: "2027-02" });
    click(trigger());
    expect(month(2026, 9).disabled).toBe(true);
    expect(month(2026, 10).disabled).toBe(false);
    key(month(2026, 10), "ArrowLeft");
    expect((document.activeElement as HTMLElement).getAttribute("data-month")).toBe("2026-10");
    key(document.activeElement!, "End");
    expect((document.activeElement as HTMLElement).getAttribute("data-month")).toBe("2026-12");
    key(document.activeElement!, "PageDown");
    expect((document.activeElement as HTMLElement).getAttribute("data-month")).toBe("2027-2");
    expect(q<HTMLButtonElement>('[aria-label="Next year"]')!.disabled).toBe(true);
  });

  it("changes the year with its buttons or a strictly validated year box", () => {
    field();
    click(trigger());
    click(q('[aria-label="Next year"]')!);
    expect(month(2027, 1)).not.toBeNull();
    const year = q<HTMLInputElement>('input[aria-label="Year"]')!;
    typeInto(year, "20");
    expect(year.getAttribute("aria-invalid")).toBe("true");
    expect(month(2027, 1)).not.toBeNull();
    typeInto(year, "2031");
    expect(month(2031, 5)).not.toBeNull();
    expect(year.getAttribute("aria-invalid")).toBeNull();
    typeInto(year, "10000");
    expect(year.getAttribute("aria-invalid")).toBe("true");
    expect(month(2031, 5)).not.toBeNull();
  });

  it("offers This month and, only when optional, Clear", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
    const onChange = vi.fn();
    field({ onChange, value: "2026-03" });
    click(trigger());
    const names = [...host.container.querySelectorAll(".calendar-action")].map((b) => b.textContent);
    expect(names).toEqual(["Clear", "This month"]);
    click([...host.container.querySelectorAll<HTMLButtonElement>(".calendar-action")].find((b) => b.textContent === "This month")!);
    expect(onChange).toHaveBeenCalledWith("2026-10");
    field({ required: true });
    click(trigger());
    expect([...host.container.querySelectorAll(".calendar-action")].map((b) => b.textContent)).toEqual(["This month"]);
  });

  it("types in the region's order, reports valid months only, and tells the caller about blur once focus truly leaves", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    field({ onChange, onBlur });
    focus(input());
    typeInto(input(), "13/2026");
    typeInto(input(), "03/2027");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2027-03");
    blurTo(input(), q<HTMLElement>(".date-field-trigger")!);
    expect(onBlur).not.toHaveBeenCalled();
    blurTo(q<HTMLElement>(".date-field-trigger")!, null);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onBlur.mock.calls[0][0].target).toBeInstanceOf(HTMLInputElement);
  });

  it("explains a saved month outside its limits and stays invalid until corrected", () => {
    field({ value: "2026-01", min: "2026-10" });
    expect(q(".date-field-problem")?.textContent).toBe("Choose Oct 2026 or a later month.");
    expect(input().validationMessage).toBe("Choose Oct 2026 or a later month.");
    expect(input().value).toBe("01/2026");
  });

  it("passes its label, id, data hooks and autofocus through to the box", () => {
    field({ id: "wm", "aria-label": "Withdraw month", autoFocus: true, ...({ "data-acc-withdraw": "" } as object) });
    expect(input().id).toBe("wm");
    expect(input().getAttribute("aria-label")).toBe("Withdraw month");
    expect(input().hasAttribute("data-acc-withdraw")).toBe(true);
    expect(document.activeElement).toBe(input());
  });
});
