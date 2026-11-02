// @vitest-environment jsdom
//
// The one date field: a text box in the region's order and a calendar button, written out as "Oct 4, 2026"
// while it isn't being edited. The stored value is always "YYYY-MM-DD".
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { DateField } from "./DateField";
import { blurTo, click, focus, key, typeInto, useHost } from "./calendar/calendarTestUtils";

describe("DateField", () => {
  const host = useHost();
  const input = () => host.container.querySelector<HTMLInputElement>("input")!;
  const text = () => host.container.querySelector(".date-field-text")!;
  const trigger = () => host.container.querySelector<HTMLButtonElement>(".date-field-trigger")!;
  const problem = () => host.container.querySelector(".date-field-problem");
  const wrapper = () => host.container.querySelector(".date-field")!;
  const field = (props: Partial<React.ComponentProps<typeof DateField>> = {}) =>
    host.render(<DateField value="2026-10-04" onChange={() => {}} ariaLabel="Date" locale="en-US" {...props} />);

  it("is a text box in the region's order with the date written out while it is closed", () => {
    field();
    expect(input().type).toBe("text");
    expect(input().value).toBe("10/04/2026");
    expect(input().getAttribute("aria-label")).toBe("Date");
    expect(text().textContent).toBe("Oct 4, 2026");
    expect(text().getAttribute("aria-hidden")).toBe("true");
  });

  it("never draws or hides a native date control", () => {
    field();
    expect(host.container.querySelectorAll('input[type="date"], input[type="month"]')).toHaveLength(0);
    expect(host.container.querySelectorAll("input")).toHaveLength(1);
    expect(host.container.querySelectorAll("button")).toHaveLength(1);
  });

  it("writes the date the regional way, and always names the year", () => {
    const thisYear = new Date().getFullYear();
    field({ value: `${thisYear}-03-15` });
    expect(text().textContent).toBe(`Mar 15, ${thisYear}`);
    field({ value: "2026-10-04", locale: "en-GB" });
    expect(text().textContent).toBe("4 Oct 2026");
    expect(input().value).toBe("04/10/2026");
  });

  it("asks for a date when it's empty, or shows the given hint", () => {
    field({ value: "" });
    expect(text().textContent).toBe("Pick a date");
    expect(wrapper().classList.contains("date-field-empty")).toBe(true);
    field({ value: "", placeholder: "Any date" });
    expect(text().textContent).toBe("Any date");
  });

  it("shows the box's own text while it has focus", () => {
    field();
    expect(wrapper().classList.contains("date-field-editing")).toBe(false);
    focus(input());
    expect(wrapper().classList.contains("date-field-editing")).toBe(true);
    blurTo(input(), null);
    expect(wrapper().classList.contains("date-field-editing")).toBe(false);
  });

  it("starts in editing mode when it takes focus on mount", () => {
    field({ autoFocus: true });
    expect(document.activeElement).toBe(input());
    expect(wrapper().classList.contains("date-field-editing")).toBe(true);
  });

  it("passes the input's own class, id, title, data attributes and disabled state through", () => {
    field({ ariaLabel: "Statement ending date", className: "row-edit-input", id: "stmt", title: "Statement ending date", disabled: true, ariaDescribedBy: "tip", "data-statement-date": "" });
    const el = input();
    expect(el.classList.contains("row-edit-input")).toBe(true);
    expect(el.classList.contains("date-field-input")).toBe(true);
    expect(el.id).toBe("stmt");
    expect(el.title).toBe("Statement ending date");
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("aria-describedby")!.split(" ")[0]).toBe("tip");
    expect(el.hasAttribute("data-statement-date")).toBe(true);
    expect(wrapper().classList.contains("date-field-disabled")).toBe(true);
    expect(trigger().disabled).toBe(true);
  });

  describe("typing", () => {
    it("reports a complete valid date as a stored date, once", () => {
      const onChange = vi.fn();
      field({ onChange });
      typeInto(input(), "10/05/2026");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("2026-10-05");
    });

    it("never reports half-typed or impossible text, and keeps the draft", () => {
      const onChange = vi.fn();
      field({ onChange });
      for (const bad of ["1", "10/05", "10/05/20", "02/30/2026", "13/05/2026", "ab"]) typeInto(input(), bad);
      expect(onChange).not.toHaveBeenCalled();
      expect(input().value).toBe("ab");
      expect(input().validationMessage).toBe("Enter the date as mm/dd/yyyy.");
    });

    it("reads the same digits in the region's own order", () => {
      const us = vi.fn();
      field({ onChange: us });
      typeInto(input(), "04/10/2026");
      expect(us).toHaveBeenCalledWith("2026-04-10");
      const gb = vi.fn();
      field({ onChange: gb, locale: "en-GB", value: "2026-01-01" });
      typeInto(input(), "04/10/2026");
      expect(gb).toHaveBeenCalledWith("2026-10-04");
      const jp = vi.fn();
      field({ onChange: jp, locale: "ja-JP", value: "2026-02-02" });
      typeInto(input(), "2026/10/4");
      expect(jp).toHaveBeenCalledWith("2026-10-04");
    });

    it("accepts a pasted ISO date in any region", () => {
      const onChange = vi.fn();
      field({ onChange, locale: "de-DE" });
      typeInto(input(), "2026-12-24");
      expect(onChange).toHaveBeenCalledWith("2026-12-24");
    });

    it("does not report a date outside its limits and says why at once", () => {
      const onChange = vi.fn();
      field({ onChange, min: "2026-10-01", max: "2026-10-31" });
      typeInto(input(), "11/01/2026");
      expect(onChange).not.toHaveBeenCalled();
      expect(problem()?.textContent).toBe("Choose a date from Oct 1, 2026 to Oct 31, 2026.");
      expect(input().getAttribute("aria-invalid")).toBe("true");
    });

    it("waits for the end of IME composition before reading the text", () => {
      const onChange = vi.fn();
      field({ onChange });
      act(() => {
        input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      });
      typeInto(input(), "10/06/2026");
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledWith("2026-10-06");
    });

    it("is read-only or disabled without ever reporting a change", () => {
      const onChange = vi.fn();
      field({ onChange, readOnly: true });
      typeInto(input(), "10/06/2026");
      expect(onChange).not.toHaveBeenCalled();
      expect(trigger().disabled).toBe(true);
    });
  });

  describe("required and optional", () => {
    it("an optional field may be emptied, reported once", () => {
      const onChange = vi.fn();
      field({ onChange });
      typeInto(input(), "");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("");
      expect(input().validationMessage).toBe("");
    });

    it("a required field that is empty is invalid, and says so once the person has left it", () => {
      field({ value: "", required: true });
      expect(input().required).toBe(true);
      expect(input().validationMessage).toBe("Enter a date.");
      expect(problem()).toBeNull();
      focus(input());
      blurTo(input(), null);
      expect(problem()?.textContent).toBe("Enter a date.");
    });
  });

  describe("date range", () => {
    it("explains a date outside 1900 to 2100 and stops a form from saving it", () => {
      field({ value: "9643-12-31" });
      expect(problem()?.textContent).toBe("Choose a date between 1900 and 2100.");
      expect(input().getAttribute("aria-invalid")).toBe("true");
      expect(input().validationMessage).toBe("Choose a date between 1900 and 2100.");
      expect(input().getAttribute("aria-describedby")!.split(" ")).toContain(problem()!.id);
    });

    it("keeps a saved date visible and invalid when it falls outside the caller's limits", () => {
      field({ value: "2026-01-15", min: "2026-10-01" });
      expect(input().value).toBe("01/15/2026");
      expect(problem()?.textContent).toBe("Choose a date on or after Oct 1, 2026.");
    });

    it("clears the problem once the date is corrected", () => {
      field({ value: "9643-12-31" });
      field({ value: "2026-12-31" });
      expect(problem()).toBeNull();
      expect(input().hasAttribute("aria-invalid")).toBe(false);
      expect(input().validationMessage).toBe("");
    });

    it("reports bounds that leave nothing to choose instead of guessing", () => {
      field({ min: "2026-10-05", max: "2026-10-04" });
      expect(problem()?.textContent).toBe("No dates can be chosen here.");
    });
  });

  describe("telling the caller whether the field is usable", () => {
    it("reports a change in validity once, and a field that goes away while invalid reports valid", () => {
      const onValidityChange = vi.fn();
      field({ onValidityChange });
      expect(onValidityChange).not.toHaveBeenCalled();
      typeInto(input(), "10/0");
      expect(onValidityChange).toHaveBeenCalledTimes(1);
      expect(onValidityChange).toHaveBeenLastCalledWith(false);
      typeInto(input(), "10/0x");
      expect(onValidityChange).toHaveBeenCalledTimes(1);
      typeInto(input(), "10/07/2026");
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
      typeInto(input(), "10/0");
      host.render(<div />);
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });

    it("reports an invalid saved value straight away", () => {
      const onValidityChange = vi.fn();
      field({ value: "9643-12-31", onValidityChange });
      expect(onValidityChange).toHaveBeenCalledWith(false);
    });
  });

  describe("leaving the field", () => {
    it("moving from the box to the calendar button is not leaving", () => {
      const onBlur = vi.fn();
      field({ onBlur });
      focus(input());
      blurTo(input(), trigger());
      expect(onBlur).not.toHaveBeenCalled();
      expect(wrapper().classList.contains("date-field-editing")).toBe(true);
    });

    it("tells an ordinary caller once, when focus really leaves with a valid date", () => {
      const onBlur = vi.fn();
      field({ onBlur });
      const outside = document.createElement("button");
      document.body.append(outside);
      focus(input());
      blurTo(input(), outside);
      expect(onBlur).toHaveBeenCalledTimes(1);
      outside.remove();
    });

    it("keeps an invalid draft with its error instead of telling the caller", () => {
      const onBlur = vi.fn();
      field({ onBlur });
      focus(input());
      typeInto(input(), "10/0");
      blurTo(input(), null);
      expect(onBlur).not.toHaveBeenCalled();
      expect(input().value).toBe("10/0");
      expect(wrapper().classList.contains("date-field-editing")).toBe(true);
      expect(problem()?.textContent).toBe("Enter the date as mm/dd/yyyy.");
    });

    it("holds back the explanation while a mouse button is down, so a button below it does not move before the click lands", () => {
      vi.useFakeTimers();
      field();
      focus(input());
      typeInto(input(), "10/0");
      act(() => { document.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      blurTo(input(), null);
      expect(problem()).toBeNull();
      act(() => { document.dispatchEvent(new Event("pointerup", { bubbles: true })); });
      expect(problem()).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(problem()?.textContent).toBe("Enter the date as mm/dd/yyyy.");
    });

    it("drops a held-back explanation if the person goes back to the field before the button is released", () => {
      vi.useFakeTimers();
      field();
      focus(input());
      typeInto(input(), "10/0");
      act(() => { document.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      blurTo(input(), null);
      focus(input());
      act(() => { document.dispatchEvent(new Event("pointerup", { bubbles: true })); vi.advanceTimersByTime(1); });
      expect(problem()).toBeNull();
    });

    it("passes keys it does not use on to the caller", () => {
      const onKeyDown = vi.fn();
      field({ onKeyDown });
      key(input(), "ArrowLeft");
      key(input(), "Enter");
      expect(onKeyDown.mock.calls.map(([e]) => e.key)).toEqual(["ArrowLeft", "Enter"]);
    });
  });

  describe("an editor that saves", () => {
    it("saves the newest date once on Enter, and not again when the editor goes away", () => {
      const onCommit = vi.fn();
      field({ onCommit });
      focus(input());
      typeInto(input(), "10/09/2026");
      const enter = key(input(), "Enter");
      expect(enter.defaultPrevented).toBe(true);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith("2026-10-09");
      blurTo(input(), null);
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("saves once when focus leaves a valid date, with the date it just parsed", () => {
      const onCommit = vi.fn();
      const onChange = vi.fn(); // the caller has not re-rendered with the new value yet
      field({ onCommit, onChange });
      focus(input());
      typeInto(input(), "10/10/2026");
      blurTo(input(), null);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith("2026-10-10");
    });

    it("does not save an invalid date on Enter or on leaving, and does not let a form submit", () => {
      const onCommit = vi.fn();
      field({ onCommit });
      focus(input());
      typeInto(input(), "13/45/2026");
      const enter = key(input(), "Enter");
      expect(enter.defaultPrevented).toBe(true);
      blurTo(input(), null);
      expect(onCommit).not.toHaveBeenCalled();
      expect(problem()).not.toBeNull();
    });

    it("cancels once on Escape and never saves while going away", () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      field({ onCommit, onCancel });
      focus(input());
      typeInto(input(), "10/11/2026");
      key(input(), "Escape");
      expect(onCancel).toHaveBeenCalledTimes(1);
      blurTo(input(), null);
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not save just because the calendar opened", () => {
      const onCommit = vi.fn();
      field({ onCommit });
      focus(input());
      click(trigger());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("lets Enter through to a form when the date is fine and no editor is saving", () => {
      field();
      focus(input());
      expect(key(input(), "Enter").defaultPrevented).toBe(false);
    });

    it("blocks Enter in a form when the date is not a date", () => {
      field();
      focus(input());
      typeInto(input(), "nonsense");
      expect(key(input(), "Enter").defaultPrevented).toBe(true);
    });
  });

  describe("when the caller replaces the value", () => {
    it("drops an unfinished draft and its error when another record's date arrives", () => {
      field({ value: "2026-10-04" });
      focus(input());
      typeInto(input(), "10/0");
      blurTo(input(), null);
      expect(problem()).not.toBeNull();
      field({ value: "2027-02-03" });
      expect(input().value).toBe("02/03/2027");
      expect(problem()).toBeNull();
    });

    it("keeps what is being typed when the caller only echoes the date the field just reported", () => {
      let value = "2026-10-04";
      const onChange = (iso: string) => {
        value = iso;
        field({ value, onChange });
      };
      field({ value, onChange });
      focus(input());
      typeInto(input(), "10/05/2026");
      expect(value).toBe("2026-10-05");
      expect(input().value).toBe("10/05/2026");
    });
  });
});
