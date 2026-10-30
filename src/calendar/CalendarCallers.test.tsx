// @vitest-environment jsdom
//
// Callers whose save path is a custom click handler or a continuous update, not a native form: half-typed
// date text must be reported to them, never turned into the old date.
import { describe, expect, it, vi } from "vitest";
import { AmountEditor } from "../comparisons/AmountEditor";
import { MoreFiltersPopover } from "../MoreFiltersPopover";
import { blurTo, click, focus, typeInto, useHost } from "./calendarTestUtils";

describe("AmountEditor's date", () => {
  const host = useHost();
  const box = () => host.container.querySelector<HTMLInputElement>("input.date-field-input")!;

  it("tells the page when the date is half typed, and again when it is fixed, without changing the amount", () => {
    const onChange = vi.fn();
    const onDateValidityChange = vi.fn();
    host.render(<AmountEditor label="Savings" value={{ value: "100.00", measuredOn: "2026-10-01", explanation: "" }} onChange={onChange} onDateValidityChange={onDateValidityChange} />);
    typeInto(box(), "10/0");
    expect(onDateValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
    typeInto(box(), "10/09/2026");
    expect(onDateValidityChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ value: "100.00", measuredOn: "2026-10-09" });
  });

  it("names its date box with a real label and keeps it disabled with no amount", () => {
    host.render(<AmountEditor label="Savings" value={null} onChange={() => {}} />);
    expect(box().disabled).toBe(true);
    const label = [...host.container.querySelectorAll("label")].find((l) => l.textContent === "Savings: date measured")!;
    expect(label.htmlFor).toBe(box().id);
  });
});

describe("More filters", () => {
  const host = useHost();

  it("Clear all drops a half-typed date as well as the saved ones", () => {
    const onSetFrom = vi.fn();
    host.render(<MoreFiltersPopover filterFrom="2026-10-01" onSetFrom={onSetFrom} filterTo="" onSetTo={() => {}} filterTag="all" allTags={[]} onSetTag={() => {}} />);
    click(host.container.querySelector(".account-filter-toggle")!);
    const from = () => host.container.querySelector<HTMLInputElement>('input[aria-label="From date"]')!;
    focus(from());
    typeInto(from(), "10/");
    blurTo(from(), null);
    expect(host.container.querySelector(".date-field-problem")).not.toBeNull();
    click([...host.container.querySelectorAll("button")].find((b) => b.textContent === "Clear all")!);
    expect(onSetFrom).toHaveBeenCalledWith("");
    expect(host.container.querySelector(".date-field-problem")).toBeNull();
    expect(from().value).toBe("10/01/2026"); // the caller has not cleared its value in this test; the half-typed text is gone
  });

  it("labels each date box with a real label", () => {
    host.render(<MoreFiltersPopover filterFrom="" onSetFrom={() => {}} filterTo="" onSetTo={() => {}} filterTag="all" allTags={[]} onSetTag={() => {}} />);
    click(host.container.querySelector(".account-filter-toggle")!);
    for (const name of ["From date", "To date"]) {
      const label = [...host.container.querySelectorAll("label")].find((l) => l.textContent === name)!;
      expect(label.htmlFor).toBe(host.container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!.id);
    }
  });
});
