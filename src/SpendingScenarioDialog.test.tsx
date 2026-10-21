import { CHANGED_BODY, CHANGED_HEADING } from "./askVault/changedState";
import { CutPreviewDialog, type CutPreviewScreen } from "./CutPreviewDialog";
import type { CutPreviewDraft, ConfirmedCutPreview } from "./askVault/cutPreviewContract";
import { calculateCutPreview } from "./askVault/cutPreviewMath";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SpendingScenarioDialog, type SpendingScenarioDialogProps, type SpendingScenarioScreen } from "./SpendingScenarioDialog";
import { FIXTURE_TODAY, fixtureBaseline, fixtureDraft, fixtureIntent, fixtureOnce, fixturePartMonth, fixturePreview, noHistoryBaseline, shortHistoryBaseline } from "./askVault/spendingScenarioFixtures";
import { calculateSpendingScenario } from "./askVault/spendingScenarioMath";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function handlers() {
  return { onChoices: vi.fn(), onConfirm: vi.fn(), onChangeTerm: vi.fn(), onManualBaseline: vi.fn(), onEdit: vi.fn(), onRestart: vi.fn(), onClose: vi.fn() } satisfies Omit<SpendingScenarioDialogProps, "screen">;
}
function mount(screen: SpendingScenarioScreen) {
  const h = handlers();
  const render = (next: SpendingScenarioScreen) => act(() => root.render(<SpendingScenarioDialog screen={next} {...h} />));
  render(screen);
  return { ...h, render };
}
const text = () => document.body.textContent ?? "";
const button = (name: string | RegExp) => {
  const label = (b: Element) => b.getAttribute("aria-label") ?? b.textContent ?? "";
  const found = [...document.querySelectorAll("button")].find((b) => (typeof name === "string" ? label(b) === name : name.test(label(b))));
  if (!found) throw new Error(`No button ${name}. Buttons: ${[...document.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found as HTMLButtonElement;
};
const click = (el: Element) => act(() => (el as HTMLElement).click());
const radio = (label: string) => {
  const found = [...document.querySelectorAll("label.scenario-option")].find((l) => l.textContent?.startsWith(label));
  if (!found) throw new Error(`No option ${label}`);
  return found.querySelector("input") as HTMLInputElement;
};
const dateInput = (name: string) => {
  const found = document.querySelector(`input[aria-label="${name}"]`);
  if (!found) throw new Error(`No date field ${name}`);
  return found as HTMLInputElement;
};
function type(input: HTMLInputElement, value: string) {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the choices screen", () => {
  const choices = (over = {}, today = FIXTURE_TODAY): SpendingScenarioScreen => ({ stage: "choices", draft: fixtureDraft(over), today });
  const review = () => click(button("Review the details"));

  it("says nothing has been calculated, keeps the person's question in view and waits for every answer", () => {
    const h = mount(choices());
    expect(text()).toContain("Nothing has been calculated yet.");
    expect(text()).toContain("how much would I save this year if I spent $50 less on Dining");
    expect(button("Review the details").disabled).toBe(true);
    expect(h.onChoices).not.toHaveBeenCalled();
  });

  it("asks how often first, and only then the dates that follow from the answer", () => {
    mount(choices());
    expect(text()).toContain("How often would you spend $50.00 less?");
    expect(text()).not.toContain("Which dates should I use?");
    click(radio("Every month"));
    expect(text()).toContain("Which dates should I use?");
    expect(text()).toContain("From now until December 31, 2026");
    expect(text()).toContain("The whole of 2026 as a what-if");
    expect(text()).toContain("Dates I choose");
  });

  it("returns explicit dates for the rest of the year, with the part month counted by the day", () => {
    const h = mount(choices());
    click(radio("Every month"));
    click(radio("From now until December 31, 2026"));
    expect(text()).toContain("Your schedule starts part-way through October.");
    expect(text()).toContain("October 15 to 31 is 17 of 31 days, so October counts 17/31 of a month.");
    expect(button("Review the details").disabled).toBe(true);
    click(radio("Count the part month by the day"));
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ cadence: "monthly", range: { kind: "prospective", from: "2026-10-15", to: "2026-12-31" }, partialMonth: "prorate" });
  });

  it("whole months only moves the start to the next month and says so in dates", () => {
    const h = mount(choices());
    click(radio("Every month"));
    click(radio("From now until December 31, 2026"));
    click(radio("Count only whole months"));
    expect(text()).toContain("November 1, 2026 to December 31, 2026 (2 months)");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ cadence: "monthly", range: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, partialMonth: "exclude" });
  });

  it("a whole-year what-if needs no part-month answer and is returned as a what-if", () => {
    const h = mount(choices());
    click(radio("Every month"));
    click(radio("The whole of 2026 as a what-if"));
    expect(text()).not.toContain("part-way");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ cadence: "monthly", range: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" }, partialMonth: "exclude" });
  });

  it("on the first of the month there is no part month to ask about", () => {
    mount(choices({}, "2026-11-01"));
    click(radio("Every month"));
    click(radio("From now until December 31, 2026"));
    expect(text()).not.toContain("part-way");
    expect(button("Review the details").disabled).toBe(false);
  });

  it("dates the person chooses: both ends are required, not in the past, in order and within 12 months", () => {
    const h = mount(choices());
    click(radio("Every month"));
    click(radio("Dates I choose"));
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Schedule start"), "2026-10-01");
    type(dateInput("Schedule end"), "2026-12-31");
    expect(document.querySelector("[role='alert']")!.textContent).toContain("can't start before today");
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Schedule start"), "2027-02-01");
    type(dateInput("Schedule end"), "2027-01-31");
    expect(document.querySelector("[role='alert']")!.textContent).toContain("end can't be before");
    type(dateInput("Schedule end"), "2028-03-31");
    expect(document.querySelector("[role='alert']")!.textContent).toContain("12 months");
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Schedule end"), "2027-06-30");
    expect(document.querySelector("[role='alert']")).toBeNull();
    expect(text()).toContain("5 months");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ cadence: "monthly", range: { kind: "prospective", from: "2027-02-01", to: "2027-06-30" }, partialMonth: "exclude" });
  });

  it("a one-time cut cannot move on without a date, and returns exactly the date chosen", () => {
    const h = mount(choices());
    click(radio("Just once"));
    expect(text()).toContain("Which date?");
    expect(text()).not.toContain("Which dates should I use?");
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Date of the one-time cut"), "2026-10-14");
    expect(document.querySelector("[role='alert']")!.textContent).toContain("can't be before today");
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Date of the one-time cut"), "2026-10-20");
    expect(document.querySelector("[role='alert']")).toBeNull();
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ cadence: "once", range: { kind: "prospective", from: "2026-10-20", to: "2026-10-20" }, partialMonth: "none" });
  });

  it("shows no complaint before the person has typed a date", () => {
    mount(choices());
    click(radio("Just once"));
    expect(document.querySelector("[role='alert']")).toBeNull();
    click(radio("Every month"));
    click(radio("Dates I choose"));
    expect(document.querySelector("[role='alert']")).toBeNull();
    type(dateInput("Schedule start"), "2026-11-01");
    expect(document.querySelector("[role='alert']")).toBeNull();
  });

  it("choosing just once for a draft that already has a multi-month range asks for one date inside that range", () => {
    const range = { kind: "prospective" as const, from: "2026-11-01", to: "2026-12-31" };
    const h = mount(choices({ horizon: range, missing: ["cadence", "partial-month"] }));
    click(radio("Just once"));
    expect(text()).toContain("Which date?");
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Date of the one-time cut"), "2027-01-05");
    expect(document.querySelector("[role='alert']")!.textContent).toContain("inside your dates");
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Date of the one-time cut"), "2026-10-20");
    expect(document.querySelector("[role='alert']")!.textContent).toContain("inside your dates");
    type(dateInput("Date of the one-time cut"), "2026-11-20");
    expect(document.querySelector("[role='alert']")).toBeNull();
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ cadence: "once", range: { kind: "prospective", from: "2026-11-20", to: "2026-11-20" }, partialMonth: "none" });
  });

  it("a draft that is already one-time with a multi-month range also needs one date, never the whole range", () => {
    const h = mount(choices({ cadence: "once", horizon: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, partialMonth: "none", missing: [] }));
    expect(text()).toContain("Which date?");
    expect(button("Review the details").disabled).toBe(true);
    type(dateInput("Date of the one-time cut"), "2026-12-24");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ range: { kind: "prospective", from: "2026-12-24", to: "2026-12-24" }, partialMonth: "none" });
  });

  it("a draft that already names one day is not asked for a date again", () => {
    const h = mount(choices({ cadence: "once", horizon: { kind: "prospective", from: "2026-10-20", to: "2026-10-20" }, partialMonth: "none", missing: [] }));
    expect(text()).not.toContain("Which date?");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ partialMonth: "none" });
  });

  it("a percentage cannot be taken just once: the option is unavailable and says why", () => {
    const h = mount(choices({ reduction: { kind: "percent", amount: "10" } }));
    expect(radio("Just once").disabled).toBe(true);
    expect(text()).toContain("A one-time cut needs a dollar amount, not a percentage.");
    click(radio("Just once"));
    expect(radio("Just once").checked).toBe(false);
    expect(button("Review the details").disabled).toBe(true);
    click(radio("Every month"));
    click(radio("The whole of 2026 as a what-if"));
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ cadence: "monthly", range: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" }, partialMonth: "exclude" });
  });

  it("a draft that is already one-time with a percentage cannot be reviewed", () => {
    mount(choices({ cadence: "once", reduction: { kind: "percent", amount: "10" }, partialMonth: "none", missing: ["horizon"] }));
    expect(text()).toContain("A one-time cut needs a dollar amount, not a percentage.");
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close"]);
  });

  it("a whole-year what-if cannot be taken just once either", () => {
    mount(choices({ horizon: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" }, missing: ["cadence"] }));
    expect(radio("Just once").disabled).toBe(true);
    expect(text()).toContain("A whole-year what-if is counted every month.");
  });

  it("an already-one-time draft with no date still asks for the date, and never defaults to today", () => {
    const h = mount(choices({ cadence: "once", partialMonth: "none", missing: ["horizon"] }));
    expect(text()).not.toContain("How often");
    expect(button("Review the details").disabled).toBe(true);
    review();
    expect(h.onChoices).not.toHaveBeenCalled();
    type(dateInput("Date of the one-time cut"), "2026-10-15");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ range: { kind: "prospective", from: "2026-10-15", to: "2026-10-15" }, partialMonth: "none" });
  });

  it("a part month in the person's own schedule is explained with that schedule's month, not today's", () => {
    const h = mount(choices({ cadence: "monthly", horizon: { kind: "prospective", from: "2027-02-15", to: "2027-03-31" }, missing: ["partial-month"] }));
    expect(text()).toContain("Your schedule starts part-way through February.");
    expect(text()).toContain("February 15 to 28 is 14 of 28 days, so February counts 14/28 of a month.");
    expect(text()).not.toContain("October");
    click(radio("Count only whole months"));
    expect(text()).toContain("March 1, 2027 to March 31, 2027 (1 month)");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ range: { kind: "prospective", from: "2027-03-01", to: "2027-03-31" }, partialMonth: "exclude" });
  });

  it("a part month at the end of the schedule is asked about too, with its own days", () => {
    const h = mount(choices({ cadence: "monthly", horizon: { kind: "prospective", from: "2026-11-01", to: "2027-02-14" }, missing: ["partial-month"] }));
    expect(text()).toContain("Your schedule ends part-way through February.");
    expect(text()).toContain("February 1 to 14 is 14 of 28 days, so February counts 14/28 of a month.");
    click(radio("Count only whole months"));
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ range: { kind: "prospective", from: "2026-11-01", to: "2027-01-31" }, partialMonth: "exclude" });
  });

  it("when no whole month is left the whole-months option is unavailable and says why", () => {
    mount(choices({ cadence: "monthly", horizon: { kind: "prospective", from: "2026-10-15", to: "2026-10-31" }, missing: ["partial-month"] }));
    expect(radio("Count only whole months").disabled).toBe(true);
    expect(text()).toContain("That leaves no whole month in your dates.");
    click(radio("Count the part month by the day"));
    expect(button("Review the details").disabled).toBe(false);
  });

  it("only asks what is missing: a known cadence is not asked again, and a known range is kept", () => {
    const h = mount(choices({ cadence: "monthly", horizon: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, missing: ["partial-month"] }));
    expect(text()).not.toContain("How often");
    expect(text()).not.toContain("part-way");
    review();
    expect(h.onChoices).toHaveBeenCalledWith({ partialMonth: "exclude" });
  });

  it("a missing category or amount is not guessed: there is no review button, only a way to ask again", () => {
    mount(choices({ category: null, missing: ["category", "cadence"] }));
    expect(text()).toContain("name the category you mean");
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close"]);
  });

  it("is a labelled dialog whose questions are real radio groups", () => {
    mount(choices());
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.querySelectorAll("fieldset legend")).toHaveLength(1);
    expect(document.querySelectorAll("input[type='radio']")).toHaveLength(2);
  });

  it("Escape closes it, but a click outside does not throw the answers away", () => {
    const h = mount(choices());
    click(document.querySelector(".modal-overlay")!);
    expect(h.onClose).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("a different draft starts clean: nothing chosen for the old one carries over", () => {
    const h = mount(choices());
    click(radio("Just once"));
    h.render(choices({ category: "Groceries", sourceText: "Save $25 in Groceries", reduction: { kind: "money", amount: "25" } }));
    expect(button("Review the details").disabled).toBe(true);
    expect(radio("Just once").checked).toBe(false);
    expect(text()).toContain("Save $25 in Groceries");
  });
});

describe("the reading screen", () => {
  it("says what is happening and that nothing is calculated, and can be cancelled", () => {
    const h = mount({ stage: "reading", category: "Dining" });
    expect(document.querySelector("[role='status']")!.textContent).toBe("Reading your last three months of Dining…");
    expect(text()).toContain("Nothing has been calculated yet.");
    click(button("Cancel"));
    expect(h.onClose).toHaveBeenCalled();
  });
});

describe("the review screen with a full history", () => {
  const review = (intent = fixtureIntent(), baseline = fixtureBaseline()): SpendingScenarioScreen => ({ stage: "review", intent, baseline });

  it("lists every term in words, all three months and the usual month", () => {
    mount(review());
    expect(text()).toContain("Check these details");
    expect(text()).toContain("Dining");
    expect(text()).toContain("$50.00 every month");
    expect(text()).toContain("November 1, 2026 to December 31, 2026 (2 months)");
    expect(text()).toContain("Not counted, whole months only");
    for (const row of ["July 2026", "$300.00", "August 2026", "$330.00", "September 2026", "$270.00"]) expect(text()).toContain(row);
    expect(text()).toContain("A usual month of Dining: $300.00");
    expect(text()).toContain("one big month does count");
    expect(text()).toContain("I cannot tell if you forgot to import something.");
  });

  it("confirms the recorded baseline with the single primary button", () => {
    const h = mount(review());
    click(button("Show what I would save"));
    expect(h.onConfirm).toHaveBeenCalledWith({ kind: "recorded" });
  });

  it("each Change link names its term, so a person can edit it before confirming", () => {
    const h = mount(review());
    click(button("Change category"));
    click(button("Change spend less by"));
    click(button("Change dates"));
    click(button("Change part months"));
    expect(h.onChangeTerm.mock.calls.map((call) => call[0])).toEqual(["category", "reduction", "horizon", "partial-month"]);
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it("a one-time cut has a date and no part-month row", () => {
    mount(review(fixtureOnce()));
    expect(text()).toContain("October 20, 2026");
    expect(text()).not.toContain("Part months");
    expect(document.querySelector("[aria-label='Change date']")).not.toBeNull();
  });

  it("shows a part-month rule the person chose", () => {
    mount(review(fixturePartMonth()));
    expect(text()).toContain("October 15, 2026 to December 31, 2026 (3 months)");
    expect(text()).toContain("Counted by the day");
  });
});

describe("the review screen with a short or missing history", () => {
  const short = (): SpendingScenarioScreen => ({ stage: "review", intent: fixtureIntent(), baseline: shortHistoryBaseline() });

  it("names the month that is left out and does not choose for the person", () => {
    const h = mount(short());
    expect(text()).toContain("Only 2 of the last 3 months can be used.");
    expect(text()).toContain("August (no records) is left out rather than counted as $0.00.");
    expect(text()).toContain("Left out: no records");
    expect(text()).toContain("A usual month of Dining: $150.00, from 2 months.");
    expect(radio("Use the 2 months I have").checked).toBe(false);
    expect(radio("Enter a usual month myself").checked).toBe(false);
    expect(button("Show what I would save").disabled).toBe(true);
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it("accepting the months there are is an explicit act that is passed on as such", () => {
    const h = mount(short());
    click(radio("Use the 2 months I have"));
    click(button("Show what I would save"));
    expect(h.onConfirm).toHaveBeenCalledWith({ kind: "recorded", shortHistoryAccepted: true });
  });

  it("lets the person enter their own usual month, validates it, and labels it as not checked", () => {
    const h = mount(short());
    click(radio("Enter a usual month myself"));
    expect(text()).toContain("This is your own number. It is not checked against your records.");
    const input = document.querySelector("input[inputmode='decimal']") as HTMLInputElement;
    for (const bad of ["", "abc", "-5", "1e3", "12.345", "1,000"]) {
      type(input, bad);
      click(button("Show what I would save"));
      expect(document.querySelector("[role='alert']")!.textContent).toBe("Enter an amount like 300 or 300.50.");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    }
    expect(h.onConfirm).not.toHaveBeenCalled();
    type(input, "150.5");
    expect(document.querySelector("[role='alert']")).toBeNull();
    click(button("Show what I would save"));
    expect(h.onConfirm).toHaveBeenCalledWith({ kind: "manual", monthlyAmount: "150.5" });
  });

  it("with no month to count it gives no number of its own, still shows every term, and asks for the person's", () => {
    const h = mount({ stage: "review", intent: fixtureIntent(), baseline: noHistoryBaseline() });
    expect(text()).toContain("I cannot tell what a usual month is");
    expect(text()).toContain("None of the last three months has complete records for Dining.");
    expect(text()).toContain("I have not calculated anything.");
    expect(text()).not.toContain("A usual month of Dining:");
    for (const term of ["Dining", "$50.00 every month", "November 1, 2026 to December 31, 2026 (2 months)", "Not counted, whole months only"]) expect(text()).toContain(term);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(3);
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Show what I would save")).toBe(false);
    click(button("Use this amount"));
    expect(h.onConfirm).not.toHaveBeenCalled();
    type(document.querySelector("input[inputmode='decimal']") as HTMLInputElement, "300");
    click(button("Use this amount"));
    expect(h.onConfirm).toHaveBeenCalledWith({ kind: "manual", monthlyAmount: "300" });
    click(button("Change dates"));
    expect(h.onChangeTerm).toHaveBeenCalledWith("horizon");
  });

  it("an existing manual baseline is confirmed as manual, with its amount, a plain label and its terms", () => {
    const h = mount({ stage: "review", intent: fixtureIntent(), baseline: { kind: "manual", monthlyAmount: "300", source: fixtureBaseline().source } });
    expect(text()).toContain("not checked against your records");
    expect(text()).not.toContain("from 0 months");
    expect(text()).not.toContain("A usual month of Dining: $300.00. That is the three months");
    expect(text()).toContain("$50.00 every month");
    expect((document.querySelector("input[inputmode='decimal']") as HTMLInputElement).value).toBe("300");
    click(button("Show what I would save"));
    expect(h.onConfirm).toHaveBeenCalledWith({ kind: "manual", monthlyAmount: "300" });
  });

  it("an existing manual baseline can be corrected before it is confirmed, and is validated the same way", () => {
    const h = mount({ stage: "review", intent: fixtureIntent(), baseline: { kind: "manual", monthlyAmount: "300", source: fixtureBaseline().source } });
    const input = document.querySelector("input[inputmode='decimal']") as HTMLInputElement;
    type(input, "oops");
    click(button("Show what I would save"));
    expect(document.querySelector("[role='alert']")!.textContent).toBe("Enter an amount like 300 or 300.50.");
    type(input, "275.25");
    click(button("Show what I would save"));
    expect(h.onConfirm).toHaveBeenCalledWith({ kind: "manual", monthlyAmount: "275.25" });
  });
});

describe("what the review says its figures are based on", () => {
  it("names the data: every account, the whole household, this category only, and the date", () => {
    mount({ stage: "review", intent: fixtureIntent(), baseline: fixtureBaseline() });
    expect(text()).toContain("Based on every account and everyone in your household, Dining spending only, as of October 15, 2026.");
  });

  it("says a manual number is the person's own and not from their records", () => {
    mount({ stage: "review", intent: fixtureIntent(), baseline: { kind: "manual", monthlyAmount: "300", source: fixtureBaseline().source } });
    expect(text()).toContain("Based on the usual month you entered for Dining, not on your records, as of October 15, 2026.");
  });
});

describe("the result screen", () => {
  it("shows the saving, the monthly limit, the terms and the plain caution, and can only change or finish", () => {
    const h = mount({ stage: "result", calculation: fixturePreview() });
    const result = document.querySelector("[role='status']")!;
    expect(result.textContent).toContain("Spending $50.00 less on Dining each month from November 1, 2026 to December 31, 2026 would save");
    expect(result.textContent).toContain("$100.00");
    expect(result.textContent).toContain("Your Dining limit would be $250.00 a month instead of a usual $300.00.");
    expect(text()).toContain("not money promised to be in your bank account");
    expect(text()).toContain("leaves out any investment growth");
    expect(text()).toContain("Nothing in your data was changed.");
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Change the details", "Done"]);
    click(button("Change the details"));
    expect(h.onEdit).toHaveBeenCalled();
    click(button("Done"));
    expect(h.onClose).toHaveBeenCalled();
  });

  it("shows each month's saving with a total, and the part month as days", () => {
    mount({ stage: "result", calculation: fixturePreview(fixturePartMonth()) });
    expect(text()).toContain("October 2026 (17 of 31 days)");
    expect(text()).toContain("$27.42");
    expect(text()).toContain("$127.42");
    expect(document.querySelector("details")!.hasAttribute("open")).toBe(true);
  });

  it("keeps a long month list out of the way: more than five months open collapsed", () => {
    const intent = fixtureIntent({ horizon: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" } });
    mount({ stage: "result", calculation: fixturePreview(intent) });
    const first = document.querySelector("details")!;
    expect(first.querySelector("summary")!.textContent).toBe("Month by month (12 months)");
    expect(first.hasAttribute("open")).toBe(false);
    expect(text()).toContain("$600.00");
  });

  it("explains the cent when rounded lines would not add up to the total", () => {
    const intent = fixtureIntent({ reduction: { kind: "percent", amount: "100" }, horizon: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" } });
    mount({ stage: "result", calculation: fixturePreview(intent, fixtureBaseline([["0.01", "complete"], ["0", "complete"], ["0", "complete"]])) });
    expect(text()).toContain("$0.04");
    expect(text()).toContain("Each amount is rounded to the cent on its own, so the lines may not add up exactly to the total.");
  });

  it("a whole-year what-if says in the result itself that it includes months that have already passed", () => {
    const intent = fixtureIntent({ horizon: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" } });
    mount({ stage: "result", calculation: fixturePreview(intent) });
    expect(document.querySelector("[role='status']")!.textContent).toContain("It includes months that have already passed, so it is not money you have already saved.");
  });

  it("a percentage result shows what the percentage is of, in dollars", () => {
    mount({ stage: "result", calculation: fixturePreview(fixtureIntent({ reduction: { kind: "percent", amount: "10" } })) });
    expect(document.querySelector("[role='status']")!.textContent).toContain("10% of a usual month of Dining ($300.00) is $30.00 a month.");
  });

  it("explains how the usual month was worked out with the same import caveat as the review", () => {
    mount({ stage: "result", calculation: fixturePreview() });
    expect(text()).toContain("A month counts when your records cover it. I cannot tell if you forgot to import something.");
  });

  it("a short history the person accepted says it rests on fewer months", () => {
    const accepted = { ...shortHistoryBaseline(), shortHistoryAccepted: true as const };
    mount({ stage: "result", calculation: fixturePreview(fixtureIntent(), accepted) });
    expect(text()).toContain("This rests on 2 months, which you chose to use.");
  });

  it("a one-time result has no month table and says there is no monthly limit", () => {
    mount({ stage: "result", calculation: fixturePreview(fixtureOnce()) });
    expect(text()).toContain("A one-time cut does not set a monthly limit.");
    expect(text()).toContain("$25.00");
    expect(text()).not.toContain("Month by month");
  });

  it("a manual baseline is described as the person's own number", () => {
    mount({ stage: "result", calculation: fixturePreview(fixtureIntent(), { kind: "manual", monthlyAmount: "300", source: fixtureBaseline().source }) });
    const summaries = [...document.querySelectorAll("summary")];
    act(() => (summaries.find((s) => s.textContent === "How the usual month was worked out") as HTMLElement).click());
    expect(text()).toContain("You entered $300.00 as a usual month of Dining. It was not checked against your records.");
  });
});

describe("the screens that stop short of a number", () => {
  it("does not recommend a rounded-up usual month as an allowed cut", () => {
    const intent = fixtureIntent({ reduction: { kind: "money", amount: "0.02" } });
    const baseline = fixtureBaseline([["0.01", "complete"], ["0.02", "complete"], ["0.02", "complete"]]);
    expect(calculateSpendingScenario({ intent, baseline, confirmed: true }).kind).toBe("reduction-too-large");
    mount({ stage: "refused", intent, baseline });
    expect(text()).toContain("$0.02");
    expect(text()).not.toContain("Try $0.02 or less");
    expect(text()).toContain("rounded to cents");
  });

  it("a cut bigger than a usual month is refused with the figures and a way to fix it", () => {
    const h = mount({ stage: "refused", intent: fixtureIntent({ reduction: { kind: "money", amount: "301" } }), baseline: fixtureBaseline() });
    expect(document.querySelector("[role='alert']")!.textContent).toContain("$301.00 a month is more than a usual month of Dining.");
    expect(text()).toContain("I have not calculated a result.");
    expect(text()).toContain("A usual month of Dining is $300.00, shown rounded to cents. Your cut is above the amount before rounding. Try a smaller amount.");
    expect(text()).not.toContain("would save");
    click(button("Change the amount"));
    expect(h.onEdit).toHaveBeenCalled();
  });

  it("a refused one-time cut also offers the person's own usual month; a monthly one does not", () => {
    const once = mount({ stage: "refused", intent: { ...fixtureOnce(), reduction: { kind: "money", amount: "301" } }, baseline: fixtureBaseline() });
    click(button("Use my own usual month"));
    expect(once.onManualBaseline).toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);
    mount({ stage: "refused", intent: fixtureIntent({ reduction: { kind: "money", amount: "301" } }), baseline: fixtureBaseline() });
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Use my own usual month")).toBe(false);
  });

  it("changed transactions retire the result and say nothing was changed", () => {
    const h = mount({ stage: "stale", message: CHANGED_BODY });
    expect(document.querySelector("[role='dialog']")!.textContent).toContain(CHANGED_HEADING);
    expect(document.querySelector("[role='alert']")!.textContent).toContain(CHANGED_BODY);
    expect(text()).toContain("Nothing was saved or changed.");
    click(button("Start again"));
    expect(h.onRestart).toHaveBeenCalled();
  });

  it("an error is plain, says nothing was calculated and can be retried", () => {
    const h = mount({ stage: "error", message: "I couldn't answer that right now. Try again in a moment." });
    expect(document.querySelector("[role='alert']")!.textContent).toBe("I couldn't answer that right now. Try again in a moment. Nothing was calculated.");
    click(button("Try again"));
    expect(h.onRestart).toHaveBeenCalled();
  });
});


describe('M4 cut preview screen conformance',()=>{
 const source=()=>({generation:3,sessionRevision:4,revision:{local:5,external:2},asOf:'2026-10-16'});
 function scenario():ConfirmedCutPreview{return {confirmed:true,source:source(),intent:{version:1,target:{kind:'monthly',amount:'115'},allocationPolicy:'capacity-proportional',categories:[{category:'Dining',monthlyFloor:'100',maximumReduction:{kind:'percent',amount:'50'}},{category:'Travel',monthlyFloor:'100',maximumReduction:{kind:'money',amount:'80'}}],horizon:{kind:'prospective',from:'2026-11-01',to:'2026-12-31'},partialMonth:'exclude'},baselines:[{category:'Dining',baseline:{kind:'manual',monthlyAmount:'300',source:source()}},{category:'Travel',baseline:{kind:'manual',monthlyAmount:'200',source:source()}}]};}
 function draft():CutPreviewDraft{return {sourceText:'Where can I cut back to save $115 monthly?',target:{kind:'monthly',amount:'115'},categories:[],excludedCategories:['Rent'],horizon:{kind:'prospective',from:'2026-11-01',to:'2026-12-31'},partialMonth:'exclude',missing:['categories','constraints']};}
 const choices=(d=draft(),categories=['Dining','Travel','Rent']):CutPreviewScreen=>({stage:'choices',draft:d,today:'2026-10-16',categories});
 function mount4(screen:CutPreviewScreen){const h={onChoices:vi.fn(),onConfirm:vi.fn(),onRemoveCategory:vi.fn(),onEdit:vi.fn(),onRestart:vi.fn(),onClose:vi.fn()};const render=(next:CutPreviewScreen)=>act(()=>root.render(<CutPreviewDialog screen={next} {...h}/>));render(screen);return {...h,render};}
 const field=(label:string)=>{const el=document.querySelector<HTMLInputElement>('input[aria-label="'+label+'"]');if(!el)throw Error('No field '+label);return el;};
 const select=(name:string)=>click(field('Select '+name));
 function completeDraft(){const d=draft();d.categories=scenario().intent.categories;d.missing=[];return d;}
 function evidence(){const s=scenario();s.baselines[0].baseline={kind:'recorded',source:source(),months:[{month:'2026-07',total:'0',coverage:'no-records'},{month:'2026-08',total:'0',coverage:'no-records'},{month:'2026-09',total:'0',coverage:'no-records'}]};s.baselines[1].baseline={kind:'recorded',source:source(),months:[{month:'2026-07',total:'200',coverage:'complete'},{month:'2026-08',total:'0',coverage:'no-records'},{month:'2026-09',total:'200',coverage:'complete'}]};return s;}
 it('UI2 initially selects no roster categories/constraints and respects question exclusions',()=>{const h=mount4(choices());expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(field('Select Dining').checked).toBe(false);expect(field('Select Travel').checked).toBe(false);expect(field('Select Rent').disabled).toBe(true);expect(text()).toContain('Excluded by your question');expect(button('Review the details').disabled).toBe(true);expect(h.onChoices).not.toHaveBeenCalled();expect(document.querySelector('select')).toBeNull();});
 it('UI2 selection does not infer floor or cut cap; explicit unrestricted choice is deliberate',()=>{const h=mount4(choices());select('Dining');expect(field('Dining monthly floor').value).toBe('');expect(field('Dining maximum cut').value).toBe('');expect(button('Review the details').disabled).toBe(true);click(button('Allow up to 100% with floor $0 for Dining'));click(button('Review the details'));expect(h.onChoices).toHaveBeenCalledWith({...scenario().intent,categories:[{category:'Dining',monthlyFloor:'0',maximumReduction:{kind:'percent',amount:'100'}}]});expect(h.onConfirm).not.toHaveBeenCalled();});
 it.each(['-1','1e3','01','1.001','79228162514264337593543950336'])('UI2 invalid floor %s prevents a read',value=>{const h=mount4(choices(completeDraft()));type(field('Dining monthly floor'),value);expect(button('Review the details').disabled).toBe(true);expect(h.onChoices).not.toHaveBeenCalled();});
 it('UI2 target zero is valid while missing basis remains unresolved',()=>{const d=completeDraft();d.target={kind:null,amount:'0'};d.missing=['target-basis'];const h=mount4(choices(d));expect(button('Review the details').disabled).toBe(true);click(radio('A total over these dates'));click(button('Review the details'));expect(h.onChoices).toHaveBeenCalledWith({...scenario().intent,target:{kind:'total',amount:'0'}});});
 it('UI2 current-year hint keeps both choices explicit with no dates or proration default',()=>{const d=completeDraft();d.horizon=null;d.partialMonth=null;d.missing=['horizon','partial-month'];d.scheduleHints=[{kind:'year-choice',year:2026,choices:['remaining-year','full-year-hypothetical'],text:'this year',start:0,end:9}];const h=mount4(choices(d));expect(button('Review the details').disabled).toBe(true);click(radio('From now until December 31, 2026'));expect(button('Review the details').disabled).toBe(true);click(radio('Count the part month by the day'));click(button('Review the details'));expect(h.onChoices).toHaveBeenCalledWith({...scenario().intent,horizon:{kind:'prospective',from:'2026-10-16',to:'2026-12-31'},partialMonth:'prorate'});});
 it('UI2 remaining-year-only hint does not offer a full-year hypothetical',()=>{const d=completeDraft();d.horizon=null;d.partialMonth=null;d.scheduleHints=[{kind:'year-choice',year:2026,choices:['remaining-year'],text:'rest of this year',start:0,end:17}];mount4(choices(d));expect(text()).not.toContain('The whole of 2026 as a what-if');});
 it('UI2 hypothetical dates are explicit and labelled, with no retrospective claim',()=>{const d=completeDraft();d.horizon=null;d.partialMonth=null;const h=mount4(choices(d));click(radio('The whole of 2026 as a what-if'));click(button('Review the details'));expect(h.onChoices).toHaveBeenCalledWith({...scenario().intent,horizon:{kind:'full-year-hypothetical',from:'2026-01-01',to:'2026-12-31'},partialMonth:'exclude'});expect(text()).toContain('includes months that have already passed');});
 it('UI2 custom dates enforce order, supported years and12months without shifting silently',()=>{const d=completeDraft();d.horizon=null;d.partialMonth=null;const h=mount4(choices(d));click(radio('Dates I choose'));type(field('Schedule start'),'2026-11-01');type(field('Schedule end'),'2027-11-30');expect(button('Review the details').disabled).toBe(true);expect(text()).toContain('12');type(field('Schedule end'),'2026-12-31');click(button('Review the details'));expect(h.onChoices).toHaveBeenCalledWith(scenario().intent);});
 it('UI2 20categories are allowed; selection21 is blocked without truncating',()=>{const names=Array.from({length:21},(_,i)=>'Long category '+i);const d=completeDraft();d.categories=names.slice(0,20).map(category=>({category,monthlyFloor:'0',maximumReduction:{kind:'percent',amount:'100'}}));const h=mount4(choices(d,names));expect(field('Select '+names[20]).disabled).toBe(true);click(button('Review the details'));expect(h.onChoices.mock.calls[0][0].categories).toHaveLength(20);});
 it.each(['manual-first','short-first'])('UI3 both missing and short history can be resolved in either order: %s',order=>{const s=evidence(),h=mount4({stage:'review',scenario:s});expect(button('Show the preview').disabled).toBe(true);expect(text()).toContain('Dining');expect(text()).toContain('Travel');expect(text()).toContain('Left out');const manual=()=>type(field('Dining usual month'),'300'),short=()=>click(radio('Use 2 recorded months for Travel'));if(order==='manual-first'){manual();expect(button('Show the preview').disabled).toBe(true);short();}else{short();expect(button('Show the preview').disabled).toBe(true);manual();}expect(h.onConfirm).not.toHaveBeenCalled();click(button('Show the preview'));expect(h.onConfirm).toHaveBeenCalledTimes(1);const confirmed=h.onConfirm.mock.calls[0][0];expect(confirmed).toMatchObject({confirmed:true,baselines:[{category:'Dining',baseline:{kind:'manual',monthlyAmount:'300'}},{category:'Travel',baseline:{kind:'recorded',shortHistoryAccepted:true}}]});expect(confirmed.source).toEqual(source());});
 it('UI3 a manual fallback for short history is labelled and explicitly confirmed',()=>{const s=evidence(),h=mount4({stage:'review',scenario:s});type(field('Dining usual month'),'300');click(radio('Enter my own usual month for Travel'));type(field('Travel usual month'),'250');expect(text()).toContain('not checked against your records');click(button('Show the preview'));expect(h.onConfirm.mock.calls[0][0].baselines[1].baseline).toMatchObject({kind:'manual',monthlyAmount:'250'});});
 it.each(['','-1','1e3','0','1.001'])('UI3 missing/malformed or floor-breaking manual amount %s cannot confirm',value=>{const h=mount4({stage:'review',scenario:evidence()});click(radio('Use 2 recorded months for Travel'));type(field('Dining usual month'),value);expect(button('Show the preview').disabled).toBe(true);expect(h.onConfirm).not.toHaveBeenCalled();});
 it('UI3 remove-category is an explicit controller callback, never silent redistribution',()=>{const h=mount4({stage:'review',scenario:evidence()});click(button('Remove Dining'));expect(h.onRemoveCategory).toHaveBeenCalledWith('Dining');expect(h.onConfirm).not.toHaveBeenCalled();});
 it('UI4 every target/date/floor/cap/baseline is reviewable before confirmation',()=>{mount4({stage:'review',scenario:scenario()});for(const textPart of ['$115.00','November 1','December 31','50%','$80.00','$100.00','$300.00','$200.00','capacity'])expect(text()).toContain(textPart);});

 it('UI2 typing a cap amount does not choose dollars instead of asking for its unit',()=>{const h=mount4(choices());select('Dining');type(field('Dining monthly floor'),'0');type(field('Dining maximum cut'),'50');expect(button('Review the details').disabled).toBe(true);expect(h.onChoices).not.toHaveBeenCalled();click(button('Dining maximum cut unit'));click(button('Percent of usual month'));click(button('Review the details'));expect(h.onChoices.mock.calls[0][0].categories[0].maximumReduction).toEqual({kind:'percent',amount:'50'});});
 it('UI4 different baseline and common sources cannot be confirmed',()=>{const s=scenario();s.baselines[0].baseline.source.revision.external++;const h=mount4({stage:'review',scenario:s});expect(button('Show the preview').disabled).toBe(true);expect(h.onConfirm).not.toHaveBeenCalled();expect(text()).toMatch(/source|changed|refresh/i);});

 it('UI1 invalid manual entries have associated errors for assistive technology',()=>{mount4({stage:'review',scenario:evidence()});type(field('Dining usual month'),'1e3');const input=field('Dining usual month');expect(input.getAttribute('aria-invalid')).toBe('true');const errorId=input.getAttribute('aria-describedby');expect(errorId).toBeTruthy();expect(document.getElementById(errorId!)?.textContent).toMatch(/valid|amount|usual/i);});
 it('UI2 a leap-day single-day schedule is retained only with explicit proration',()=>{const d=completeDraft();d.horizon=null;d.partialMonth=null;const h=mount4(choices(d));click(radio('Dates I choose'));type(field('Schedule start'),'2028-02-29');type(field('Schedule end'),'2028-02-29');expect(button('Review the details').disabled).toBe(true);click(radio('Count the part month by the day'));click(button('Review the details'));expect(h.onChoices).toHaveBeenCalledWith({...scenario().intent,horizon:{kind:'prospective',from:'2028-02-29',to:'2028-02-29'},partialMonth:'prorate'});});
 it('UI2 excluding part months shows and confirms the changed dates',()=>{const d=completeDraft();d.horizon={kind:'prospective',from:'2026-10-20',to:'2026-12-31'};d.partialMonth=null;const h=mount4(choices(d));click(radio('Count only whole months'));expect(text()).toContain('November 1, 2026');click(button('Review the details'));expect(h.onChoices).toHaveBeenCalledWith(scenario().intent);});

 it('UI6 replacement choices keep focus inside the modal when a focused category is removed',()=>{const h=mount4(choices(completeDraft()));field('Dining monthly floor').focus();expect(document.activeElement).toBe(field('Dining monthly floor'));const replacement=draft();h.render(choices(replacement,['Travel','Rent']));expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);});

 it.each([['Savings target','1e3'],['Dining monthly floor','-1'],['Dining maximum cut','100.01']])('UI1 invalid %s has a field-specific associated error',(name,value)=>{mount4(choices(completeDraft()));type(field(name),value);const input=field(name);expect(input.getAttribute('aria-invalid')).toBe('true');expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();expect(button('Review the details').disabled).toBe(true);});

 it('UI1 category labels that prefix another label do not share the other category error',()=>{const s=evidence();s.intent.categories[1].category='Dining: Travel';s.baselines[1].category='Dining: Travel';mount4({stage:'review',scenario:s});type(field('Dining usual month'),'300');click(radio('Enter my own usual month for Dining: Travel'));type(field('Dining: Travel usual month'),'1e3');expect(field('Dining usual month').getAttribute('aria-invalid')).toBe('false');expect(field('Dining: Travel usual month').getAttribute('aria-invalid')).toBe('true');});

 it('UI3 one complete month requires its own explicit acceptance and clear singular wording',()=>{const s=evidence();if(s.baselines[1].baseline.kind!=='recorded')throw Error('fixture');s.baselines[1].baseline.months[2].coverage='records-end';const h=mount4({stage:'review',scenario:s});type(field('Dining usual month'),'300');expect(button('Show the preview').disabled).toBe(true);click(radio('Use 1 recorded month for Travel'));expect(h.onConfirm).not.toHaveBeenCalled();click(button('Show the preview'));expect(h.onConfirm.mock.calls[0][0].baselines[1].baseline).toMatchObject({kind:'recorded',shortHistoryAccepted:true});});
 it('UI4 changing screen/source clears unfinished history choices',()=>{const s=evidence(),h=mount4({stage:'review',scenario:s});type(field('Dining usual month'),'300');click(radio('Use 2 recorded months for Travel'));const changed=structuredClone(s);changed.source.revision.local++;changed.baselines.forEach(row=>row.baseline.source.revision.local++);h.render({stage:'review',scenario:changed});expect(field('Dining usual month').value).toBe('');expect(button('Show the preview').disabled).toBe(true);expect(h.onConfirm).not.toHaveBeenCalled();});
 it('UI5 monthly results show goal/maximum/achieved/limits and period total in correct units',()=>{const calculation=calculateCutPreview(scenario());if(calculation.kind!=='preview')throw Error('fixture');const h=mount4({stage:'result',calculation});for(const part of ['$115.00','$230.00','$75.00','$40.00','$225.00','$160.00','per month','capacity','Nothing in your data was changed'])expect(text()).toContain(part);expect(text()).not.toContain('Apply');expect(h.onConfirm).not.toHaveBeenCalled();click(button('Change the details'));expect(h.onEdit).toHaveBeenCalled();});
 it('UI5 infeasible target keeps target, maximum and explicit shortfall visible',()=>{const s=scenario();s.intent.target.amount='300';const r=calculateCutPreview(s);if(r.kind!=='preview')throw Error('fixture');mount4({stage:'result',calculation:r});for(const part of ['$300.00','$230.00','$70.00','shortfall'])expect(text().toLowerCase()).toContain(part.toLowerCase());});
 it('UI5 total-period primary allocation cents are distinct from approximate fractional monthly equivalents',()=>{const s=scenario();s.intent.target={kind:'total',amount:'0.01'};const r=calculateCutPreview(s);if(r.kind!=='preview')throw Error('fixture');mount4({stage:'result',calculation:r});expect(text()).toContain('over these dates');expect(text()).toContain('Approx. monthly');expect(text()).toContain('rounded');expect(text()).toContain('$0.01');expect(text()).toContain('not money promised');});
 it('UI5 zero capacity remains a result with maximum0 and full shortfall',()=>{const s=scenario();s.intent.categories.forEach(row=>row.maximumReduction={kind:'money',amount:'0'});const r=calculateCutPreview(s);if(r.kind!=='preview')throw Error('fixture');mount4({stage:'result',calculation:r});expect(text()).toContain('$0.00');expect(text()).toContain('$115.00');expect(text()).toMatch(/shortfall/i);});
 it.each([{stage:'blocked',calculation:{kind:'needs-baseline',categories:['Dining']}},{stage:'blocked',calculation:{kind:'constraints-invalid',violations:[{category:'Dining',monthlyFloor:'301',monthlyBaseline:{numerator:'300',denominator:'1'},reason:'floor-above-baseline'}]}}] as CutPreviewScreen[])('UI6 blocker shows no authoritative result and offers edit',screen=>{const h=mount4(screen);expect(text()).toContain('Dining');expect(document.querySelector('.cut-preview-results')).toBeNull();expect(text()).not.toMatch(/Goal:|Shortfall|Maximum|\$\d+\.\d\d per month saved/);expect(document.querySelector('[role="alert"]')?.textContent).toContain('Nothing was calculated');expect(text()).toContain('Nothing was calculated');click(button('Change the details'));expect(h.onEdit).toHaveBeenCalled();});
 it.each(['stale','error'] as const)('UI6 %s retires numbers and offers retry/close',stage=>{const h=mount4({stage,message:'Fictional source changed'});expect(text()).toContain('Fictional source changed');expect(text()).toContain('Nothing was calculated');click(button('Try again'));expect(h.onRestart).toHaveBeenCalled();click(button('Close'));expect(h.onClose).toHaveBeenCalled();});
 it('UI6 reading shows no result or confirm action and retains close',()=>{const h=mount4({stage:'reading',categories:['Dining','Travel']});expect(text()).toContain('Reading');expect(text()).toContain('Nothing has been calculated');click(button('Close'));expect(h.onClose).toHaveBeenCalled();});
});
