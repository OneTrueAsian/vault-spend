// @vitest-environment jsdom
//
// A calendar opens inside other floating things: dialogs (ModalShell) and the Transactions filter panel
// (usePopover). It must close on its own Escape, leave the thing around it open, and not make that thing
// stop trapping Tab or handling its own keys.
import { describe, expect, it, vi } from "vitest";
import { ModalShell } from "../Modal";
import { MoreFiltersPopover } from "../MoreFiltersPopover";
import { DateField } from "../DateField";
import { click, key, useHost } from "./calendarTestUtils";

const trigger = (label: string) => document.querySelector<HTMLButtonElement>(`.date-field-trigger[aria-label$="${label}"]`)!;
const calendar = () => document.querySelector('.calendar-popover[role="dialog"]');
const dialogs = () => document.querySelectorAll('[role="dialog"][aria-modal="true"]');

describe("calendar inside a dialog", () => {
  const host = useHost();
  const withDialog = (onCancel = vi.fn(), onChange = vi.fn()) => {
    host.render(
      <ModalShell title="Edit" onCancel={onCancel} footer={<button type="button">Save</button>}>
        <DateField value="2026-10-15" onChange={onChange} ariaLabel="Due" locale="en-US" />
        <button type="button" hidden>
          Hidden
        </button>
        <button type="button" style={{ display: "none" }}>
          Gone
        </button>
      </ModalShell>,
    );
    return { onCancel, onChange };
  };

  it("lets Escape close only the calendar, then the dialog on the next Escape", () => {
    const { onCancel } = withDialog();
    click(trigger("Due"));
    expect(calendar()).not.toBeNull();
    key(document.querySelector("[data-date='2026-10-15']")!, "Escape");
    expect(calendar()).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    key(document.querySelector(".date-field-trigger")!, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on an Escape something else already used, whatever order the listeners run in", () => {
    const { onCancel } = withDialog();
    const claim = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener("keydown", claim, true);
    key(document.body, "Escape");
    document.removeEventListener("keydown", claim, true);
    expect(onCancel).not.toHaveBeenCalled();
    key(document.body, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not count the calendar as a modal dialog", () => {
    withDialog();
    click(trigger("Due"));
    expect(dialogs()).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  });

  it("keeps trapping Tab at the dialog's own edges while the calendar is open", () => {
    withDialog();
    click(trigger("Due"));
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
    save.focus();
    expect(key(save, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.querySelector(".date-field-input"));
    const first = document.querySelector<HTMLElement>(".date-field-input")!;
    first.focus();
    expect(key(first, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(save);
  });

  it("lets Tab move normally from inside the calendar", () => {
    withDialog();
    click(trigger("Due"));
    const today = [...document.querySelectorAll<HTMLButtonElement>(".calendar-action")].find((b) => b.textContent === "Today")!;
    today.focus();
    expect(key(today, "Tab").defaultPrevented).toBe(false);
  });

  it("ignores hidden and out-of-tab-order controls when it finds the dialog's edges", () => {
    withDialog();
    click(trigger("Due"));
    const cells = document.querySelectorAll('[data-date][tabindex="-1"]');
    expect(cells.length).toBeGreaterThan(0);
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
    save.focus();
    key(save, "Tab");
    expect(document.activeElement).not.toBe(document.querySelector("button[hidden]"));
    expect(document.activeElement).not.toBeNull();
  });

  it("leaves the dialog's own value alone when a day is chosen, and keeps the dialog open", () => {
    const { onCancel, onChange } = withDialog();
    click(trigger("Due"));
    click(document.querySelector("[data-date='2026-10-20']")!);
    expect(onChange).toHaveBeenCalledWith("2026-10-20");
    expect(calendar()).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(1);
  });

  it("with a second dialog on top, only the uppermost one handles Escape, and a calendar below still closes first", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    host.render(
      <>
        <ModalShell title="Lower" onCancel={lower}>
          <DateField value="2026-10-15" onChange={() => {}} ariaLabel="Due" locale="en-US" />
        </ModalShell>
        <ModalShell title="Upper" onCancel={upper}>
          <p>Are you sure?</p>
        </ModalShell>
      </>,
    );
    click(trigger("Due"));
    key(document.querySelector("[data-date='2026-10-15']")!, "Escape");
    expect(calendar()).toBeNull();
    expect(upper).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
    key(document.body, "Escape");
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("restores focus to what opened the dialog when it closes, as before", async () => {
    vi.useFakeTimers();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    withDialog();
    host.render(<div />);
    await vi.advanceTimersByTimeAsync(5);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("calendar inside More filters", () => {
  const host = useHost();
  const render = (onSetFrom = vi.fn()) => {
    host.render(
      <MoreFiltersPopover filterFrom="" onSetFrom={onSetFrom} filterTo="" onSetTo={() => {}} filterTag="all" allTags={[]} onSetTag={() => {}} />,
    );
    return onSetFrom;
  };
  const toggle = () => host.container.querySelector<HTMLButtonElement>(".account-filter-toggle")!;
  const panel = () => host.container.querySelector(".more-filters-panel");

  it("stays open while a date is chosen, and closes normally on a later Escape", () => {
    const onSetFrom = render();
    click(toggle());
    expect(panel()).not.toBeNull();
    click(host.container.querySelector('.date-field-trigger[aria-label$="From date"]')!);
    expect(calendar()).not.toBeNull();
    expect(panel()).not.toBeNull();
    const cell = host.container.querySelector<HTMLButtonElement>("[data-date]:not([disabled])")!;
    click(cell);
    expect(onSetFrom).toHaveBeenCalledTimes(1);
    expect(calendar()).toBeNull();
    expect(panel()).not.toBeNull();
    key(host.container.querySelector(".date-field-input")!, "Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("closes only the calendar on the first Escape, from the grid or from the box", () => {
    render();
    click(toggle());
    click(host.container.querySelector('.date-field-trigger[aria-label$="From date"]')!);
    key(document.activeElement!, "Escape");
    expect(calendar()).toBeNull();
    expect(panel()).not.toBeNull();
    click(host.container.querySelector('.date-field-trigger[aria-label$="To date"]')!);
    key(host.container.querySelector('input[aria-label="To date"]')!, "Escape");
    expect(calendar()).toBeNull();
    expect(panel()).not.toBeNull();
  });

  it("keeps the panel open on an Escape something else already used, and closes on an ordinary one", () => {
    render();
    click(toggle());
    const claim = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener("keydown", claim, true);
    key(document.body, "Escape");
    document.removeEventListener("keydown", claim, true);
    expect(panel()).not.toBeNull();
    key(document.body, "Escape");
    expect(panel()).toBeNull();
  });

  it("leaves the panel to its calendar's Escape even when the key arrives from outside the field's own handler", () => {
    render();
    click(toggle());
    click(host.container.querySelector('.date-field-trigger[aria-label$="From date"]')!);
    key(document.body, "Escape");
    expect(panel()).not.toBeNull();
  });

  it("does not treat focus moving into its own calendar as leaving the panel", () => {
    render();
    click(toggle());
    click(host.container.querySelector('.date-field-trigger[aria-label$="From date"]')!);
    expect(panel()).not.toBeNull();
    key(document.activeElement!, "ArrowRight");
    expect(panel()).not.toBeNull();
  });
});
