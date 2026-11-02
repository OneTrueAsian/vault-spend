// @vitest-environment jsdom
// Stage 3 (M5 answer screen). Written from stage-3-answer-screen/Traceability.md before the component existed. Every test drives the real component, real contract and real calculator.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RetirementScenarioDialog } from "./RetirementScenarioDialog";
import {
  FORBIDDEN_RETIREMENT_WORDING, RETIREMENT_ANNOUNCEMENTS, RETIREMENT_COPY, RETIREMENT_FIELDS, RETIREMENT_INVALID_SCREEN_MESSAGE, RETIREMENT_PROBLEMS, retirementUnsupportedMessage,
  validateRetirementChoicesEvent,
} from "./askVault/retirementScreenContract";
import type { PreviewCalculation, RetirementChoicesEvent, RetirementDialogProps, RetirementReview, RetirementScreen } from "./askVault/retirementScreenContract";
import { calculateRetirementScenario } from "./askVault/retirementScenarioMath";
import { retirementContractExamples } from "./askVault/retirementScenarioContractExamples";
import { UNSUPPORTED_CODES } from "./askVault/retirementCorpus";
import { validateConfirmedRetirementScenario } from "./askVault/retirementScenarioContract";
import type { ConfirmedRetirementScenario, RetirementDraft, RetirementParseContext } from "./askVault/retirementScenarioContract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const TODAY = "2026-10-17";
const live: RetirementParseContext = { today: TODAY, investmentAccounts: [{ id: 7, name: "Fictional IRA" }] };
const examples = () => retirementContractExamples();
const reviewOf = (mutate: (r: RetirementReview) => void = () => {}): RetirementReview => {
  const input = examples()[0].input;
  const review: RetirementReview = { intent: input.intent, context: input.context, inflation: { kind: "stored", pct: "3" }, monthSource: "question", questionAssumptions: { annualReturnPct: null, inflationPct: null } };
  mutate(review); return review;
};
const previewOf = (patch: (s: ConfirmedRetirementScenario) => void = () => {}): PreviewCalculation => {
  const input = examples()[0].input; patch(input);
  const result = calculateRetirementScenario(input); if (result.kind !== "preview") throw new Error("expected a preview: " + JSON.stringify(result)); return result;
};
const depositsOf = (patch: (s: ConfirmedRetirementScenario) => void = () => {}) => {
  const input = examples()[0].input; input.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } }; patch(input);
  const result = calculateRetirementScenario(input); if (result.kind !== "extra-deposits-only") throw new Error("expected deposits only"); return result;
};
const missingOf = (d: Omit<RetirementDraft, "missing">): RetirementDraft["missing"] => {
  const m: RetirementDraft["missing"] = [];
  if (d.accountId === null) m.push("account"); if (d.extra.amount === null) m.push("extra-amount"); if (d.extra.kind === null) m.push("cadence"); if (d.startDate === null) m.push("start-date"); if (d.retirementMonth === null) m.push("retirement-month");
  return m;
};
const draftOf = (over: Partial<RetirementDraft> = {}): RetirementDraft => {
  const base = { sourceText: "what if I added an extra $50 a month for retirement", accountId: null, extra: { kind: "monthly" as const, amount: "50" }, startDate: TODAY, retirementMonth: null, assumptions: { annualReturnPct: null, inflationPct: null }, hints: [], ...over };
  return { ...base, missing: missingOf(base) };
};
const rosterOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Account ${i + 1}` }));
const choicesScreen = (draft: RetirementDraft, accounts = live.investmentAccounts, monthCandidate: string | null = null, savedMonthLimit: string | null = null): RetirementScreen => ({ stage: "choices", draft, accounts, today: TODAY, monthCandidate, savedMonthLimit });

function handlers() { return { onChoices: vi.fn(), onConfirm: vi.fn(), onExplore: vi.fn(), onBack: vi.fn(), onEdit: vi.fn(), onRestart: vi.fn(), onClose: vi.fn() } satisfies Omit<RetirementDialogProps, "screen" | "live" | "openReturnChoice">; }
function mount(screen: RetirementScreen, context: RetirementParseContext = live, extra: Partial<RetirementDialogProps> = {}) {
  const h = handlers();
  const render = (next: RetirementScreen, nextLive: RetirementParseContext = context, more: Partial<RetirementDialogProps> = extra) => act(() => root.render(<RetirementScenarioDialog screen={next} live={nextLive} {...h} {...more} />));
  render(screen);
  return { ...h, render };
}
const text = () => document.body.textContent ?? "";
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const allButtons = () => [...dialog().querySelectorAll<HTMLButtonElement>("button")];
const button = (name: string | RegExp) => {
  const label = (b: Element) => b.getAttribute("aria-label") ?? b.textContent ?? "";
  const found = allButtons().find(b => (typeof name === "string" ? label(b) === name : name.test(label(b))));
  if (!found) throw new Error(`No button ${name}. Buttons: ${allButtons().map(b => b.textContent).join(" | ")}`);
  return found;
};
const hasButton = (name: string | RegExp) => allButtons().some(b => (typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? "")));
const primary = () => { const found = [...dialog().querySelectorAll<HTMLButtonElement>(".modal-actions button:not(.modal-secondary)")]; expect(found.length, "primary actions").toBe(1); return found[0]; };
const click = (el: Element) => act(() => (el as HTMLElement).click());
const option = (label: string) => {
  const found = [...dialog().querySelectorAll("label.scenario-option")].find(l => l.textContent?.startsWith(label));
  if (!found) throw new Error(`No option ${label}. Options: ${[...dialog().querySelectorAll("label.scenario-option")].map(l => l.textContent).join(" | ")}`);
  return found.querySelector("input") as HTMLInputElement;
};
const hasOption = (label: string) => [...dialog().querySelectorAll("label.scenario-option")].some(l => l.textContent?.startsWith(label));
// A field is a `.modal-field` holding its caption (a span, or a real label for a month box) and its input.
const fieldCaption = (l: Element) => l.querySelector("span, label")?.textContent;
const field = (label: string) => {
  const found = [...dialog().querySelectorAll(".modal-field")].find(l => fieldCaption(l) === label);
  if (!found) throw new Error(`No field ${label}. Fields: ${[...dialog().querySelectorAll(".modal-field")].map(fieldCaption).join(" | ")}`);
  return found.querySelector("input") as HTMLInputElement;
};
const hasField = (label: string) => [...dialog().querySelectorAll(".modal-field")].some(l => fieldCaption(l) === label);
function type(input: HTMLInputElement, value: string) {
  act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
}
const problems = () => [...dialog().querySelectorAll(".scenario-problem")].map(p => p.textContent ?? "");
const confirmed = (h: ReturnType<typeof handlers>, n = 0) => h.onConfirm.mock.calls[n][0] as ConfirmedRetirementScenario;
const liveFor = (scenario: ConfirmedRetirementScenario): RetirementParseContext => ({ today: TODAY, investmentAccounts: [{ id: scenario.context.account.id, name: scenario.context.account.name }] });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
describe("D2 the dialog shows only what the contract validates against the live context", () => {
  it("shows a valid result", () => { mount({ stage: "result", calculation: previewOf() }); expect(text()).toContain("Illustrative balance at November 2026"); });
  it("shows a safe message instead of an altered result and never offers consent", () => {
    const calc = previewOf() as unknown as { extraDeposits: string }; calc.extraDeposits = "999999.00";
    const h = mount({ stage: "result", calculation: calc as never });
    expect(text()).toContain(RETIREMENT_INVALID_SCREEN_MESSAGE); expect(document.querySelector("table")).toBeNull(); expect(text()).not.toContain("999,999");
    expect(hasButton("Use my saved plan")).toBe(false); click(primary()); expect(h.onRestart).toHaveBeenCalledTimes(1); expect(h.onConfirm).not.toHaveBeenCalled();
  });
  it("does the same for a result on another day, another roster, a malformed screen and a malformed live context", () => {
    const result: RetirementScreen = { stage: "result", calculation: previewOf() };
    for (const [label, screen, ctx] of [
      ["another day", result, { ...live, today: "2026-10-18" }], ["another roster", result, { today: TODAY, investmentAccounts: [{ id: 7, name: "Renamed" }] }],
      ["no screen", null, live], ["an unknown stage", { stage: "mystery" }, live], ["no live context", result, null], ["a malformed roster", result, { today: TODAY, investmentAccounts: [null] }],
    ] as [string, unknown, unknown][]) {
      act(() => root.unmount()); root = createRoot(container);
      expect(() => mount(screen as never, ctx as never), label).not.toThrow();
      expect(text(), label).toContain(RETIREMENT_INVALID_SCREEN_MESSAGE); expect(document.querySelector("table"), label).toBeNull();
    }
  });
  it("recovers when a valid screen replaces an invalid one", () => {
    const h = mount({ stage: "result", calculation: { ...previewOf(), extraDeposits: "1.00" } as never });
    expect(text()).toContain(RETIREMENT_INVALID_SCREEN_MESSAGE); h.render({ stage: "result", calculation: previewOf() }); expect(document.querySelector("table")).not.toBeNull();
  });
  it("uses the invalid-screen message in plain words", () => { expect(RETIREMENT_INVALID_SCREEN_MESSAGE).toMatch(/Nothing was calculated\.$/); expect(RETIREMENT_INVALID_SCREEN_MESSAGE).not.toMatch(/invalid|validat|payload|undefined/i); });
});

describe("D3 the choices card", () => {
  it("introduces what was understood, asks for the account only, and keeps Continue disabled until it is chosen", () => {
    mount(choicesScreen(draftOf()));
    expect(text()).toContain("Nothing has been calculated yet. I understood: an extra $50 each month, starting today."); expect(text()).toContain("Which investment account is this for?");
    expect(hasOption("Fictional IRA")).toBe(true); expect(hasField(RETIREMENT_FIELDS.retirementMonth), "no month before the account is read").toBe(false); expect(hasField("Extra amount (dollars)")).toBe(false);
    expect(primary().textContent).toBe("Continue"); expect(primary().disabled).toBe(true);
  });
  it("reports the account step with the chosen id and a consistent draft, exactly once", () => {
    const h = mount(choicesScreen(draftOf()));
    click(option("Fictional IRA")); expect(primary().disabled).toBe(false); click(primary());
    expect(h.onChoices).toHaveBeenCalledTimes(1);
    const event = h.onChoices.mock.calls[0][0] as RetirementChoicesEvent;
    expect(event).toMatchObject({ step: "account", draft: { accountId: 7, missing: ["retirement-month"], extra: { kind: "monthly", amount: "50" }, sourceText: "what if I added an extra $50 a month for retirement" } });
    expect(validateRetirementChoicesEvent(event, live)).toEqual({ ok: true });
    expect(h.onConfirm).not.toHaveBeenCalled();
  });
  it("a double click reports one event until the screen changes", () => {
    const h = mount(choicesScreen(draftOf())); click(option("Fictional IRA")); click(primary()); click(primary()); expect(h.onChoices).toHaveBeenCalledTimes(1);
    h.render(choicesScreen(draftOf({ accountId: 7 }), live.investmentAccounts, "2050-06")); expect(hasOption("Fictional IRA")).toBe(false);
  });
  it("tells accounts with the same name apart and reports the one chosen", () => {
    const ctx = { today: TODAY, investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "Roth IRA" }] };
    const h = mount(choicesScreen(draftOf(), ctx.investmentAccounts), ctx);
    expect(hasOption("Roth IRA (1 of 2)")).toBe(true); expect(hasOption("Roth IRA (2 of 2)")).toBe(true);
    click(option("Roth IRA (2 of 2)")); click(primary()); expect((h.onChoices.mock.calls[0][0] as { draft: RetirementDraft }).draft.accountId).toBe(6);
  });
  it("uses radios for up to five accounts and a themed menu above five", () => {
    for (const n of [1, 5]) { act(() => root.unmount()); root = createRoot(container); const r = rosterOf(n); mount(choicesScreen(draftOf(), r), { today: TODAY, investmentAccounts: r }); expect(dialog().querySelectorAll('input[type="radio"]').length, `${n} accounts`).toBe(n); expect(dialog().querySelector('button[aria-haspopup="menu"]')).toBeNull(); }
    act(() => root.unmount()); root = createRoot(container);
    const six = rosterOf(6), h = mount(choicesScreen(draftOf(), six), { today: TODAY, investmentAccounts: six });
    expect(dialog().querySelectorAll('input[type="radio"]').length).toBe(0);
    const trigger = dialog().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!; expect(trigger.getAttribute("aria-label")).toContain(RETIREMENT_FIELDS.account);
    expect(primary().disabled).toBe(true); click(trigger);
    click([...document.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find(b => b.textContent?.includes("Account 4"))!); expect(primary().disabled).toBe(false);
    click(primary()); expect((h.onChoices.mock.calls[0][0] as { draft: RetirementDraft }).draft.accountId).toBe(4);
  });
  it("asks for a missing amount and cadence and reports what was typed", () => {
    const d = draftOf({ extra: { kind: null, amount: null } }), h = mount(choicesScreen(d));
    expect(text()).toContain("How much extra would you add?"); expect(hasOption("Every month")).toBe(true); expect(hasOption("Just once")).toBe(true);
    click(option("Fictional IRA")); expect(primary().disabled).toBe(true);
    type(field("Extra amount (dollars)"), "75.5"); expect(primary().disabled).toBe(true); click(option("Just once")); expect(primary().disabled).toBe(false); click(primary());
    expect(h.onChoices.mock.calls[0][0]).toMatchObject({ step: "account", draft: { accountId: 7, extra: { kind: "once", amount: "75.5" }, missing: ["retirement-month"] } });
  });
  it("explains an unusable amount in words, does not enable Continue, and accepts zero and cents", () => {
    mount(choicesScreen(draftOf({ extra: { kind: "monthly", amount: null } }))); click(option("Fictional IRA"));
    for (const bad of ["abc", "-5", "50.123", "1,000", "1e3", " 5", "5.", ".5", "99999999999999999999999999999999"]) { type(field("Extra amount (dollars)"), bad); expect(primary().disabled, bad).toBe(true); expect(problems(), bad).toEqual([RETIREMENT_PROBLEMS.extraAmount]); }
    for (const good of ["0", "50", "50.5", "50.25"]) { type(field("Extra amount (dollars)"), good); expect(primary().disabled, good).toBe(false); expect(problems(), good).toEqual([]); }
  });
  it("does not scold before the person has typed anything", () => { mount(choicesScreen(draftOf({ extra: { kind: "monthly", amount: null } }))); expect(problems()).toEqual([]); });
  it("a later start the question stated needs the person's acknowledgement before Continue", () => {
    const d = draftOf({ startDate: null }), h = mount(choicesScreen(d));
    expect(text()).toContain("This starts today. Starting on a later date isn't supported yet."); click(option("Fictional IRA")); expect(primary().disabled).toBe(true);
    click(option("Start today instead")); expect(primary().disabled).toBe(false); click(primary());
    expect(h.onChoices.mock.calls[0][0]).toMatchObject({ step: "account", draft: { accountId: 7, startDate: TODAY, missing: ["retirement-month"] } });
  });
  it("with the account known, asks for the month and offers the plan's month as a labelled candidate; the candidate is reported as such", () => {
    const d = draftOf({ accountId: 7, startDate: TODAY }), h = mount(choicesScreen(d, live.investmentAccounts, "2050-06"));
    expect(hasOption("Fictional IRA")).toBe(false); expect(hasField(RETIREMENT_FIELDS.retirementMonth)).toBe(true); expect(primary().disabled).toBe(true);
    click(button("Use June 2050, from your plan")); expect(primary().disabled).toBe(false); click(primary());
    const event = h.onChoices.mock.calls[0][0] as RetirementChoicesEvent;
    expect(event).toMatchObject({ step: "complete", monthSource: "plan-candidate", intent: { accountId: 7, retirementMonth: "2050-06", startDate: TODAY, extra: { kind: "monthly", amount: "50" } }, questionAssumptions: { annualReturnPct: null, inflationPct: null } });
    expect(validateRetirementChoicesEvent(event, live)).toEqual({ ok: true });
  });
  it("a typed month is reported as typed, the last choice wins, and clearing it disables Continue", () => {
    const h = mount(choicesScreen(draftOf({ accountId: 7 }), live.investmentAccounts, "2050-06"));
    click(button("Use June 2050, from your plan")); type(field(RETIREMENT_FIELDS.retirementMonth), "2055-03"); expect(primary().disabled).toBe(false);
    type(field(RETIREMENT_FIELDS.retirementMonth), ""); expect(primary().disabled).toBe(true); type(field(RETIREMENT_FIELDS.retirementMonth), "2055-03"); click(primary());
    expect(h.onChoices.mock.calls[0][0]).toMatchObject({ step: "complete", monthSource: "typed", intent: { retirementMonth: "2055-03" } });
  });
  it("refuses a month in the past or beyond 100 years in words", () => {
    mount(choicesScreen(draftOf({ accountId: 7 })));
    // A month outside the box's limits is refused by the box itself, in words, and never reaches the card.
    for (const bad of ["2026-09", "2101-01"]) { type(field(RETIREMENT_FIELDS.retirementMonth), bad); expect(primary().disabled, bad).toBe(true); expect(dialog().querySelector(".date-field-problem")?.textContent, bad).toBe("Choose a month from Oct 2026 to Dec 2100."); }
    for (const good of ["2026-10", "2100-12"]) { type(field(RETIREMENT_FIELDS.retirementMonth), good); expect(primary().disabled, good).toBe(false); }
  });
  it("explains a saved month beyond the supported range, offers no candidate for it, and still asks for a month inside the range", () => {
    mount(choicesScreen(draftOf({ accountId: 7 }), live.investmentAccounts, null, "2101-01"));
    expect(text()).toContain("January 2101"); expect(text()).toContain("December 2100");
    expect(allButtons().some(b => /from your plan/.test(b.textContent ?? ""))).toBe(false);
    const month = field(RETIREMENT_FIELDS.retirementMonth);
    type(month, "2101-01"); expect(primary().disabled).toBe(true); expect(dialog().querySelector(".date-field-problem")?.textContent).toMatch(/Dec 2100/);
  });
  it("says nothing about a limit when the saved month is usable or absent", () => {
    mount(choicesScreen(draftOf({ accountId: 7 }), live.investmentAccounts, "2050-06", null)); expect(text()).not.toContain("December 2100");
  });
  it("offers no candidate button when the plan has no saved month", () => { mount(choicesScreen(draftOf({ accountId: 7 }))); expect(allButtons().some(b => /from your plan/.test(b.textContent ?? ""))).toBe(false); });
  it("passes the return and inflation written in the question through to the complete step", () => {
    const h = mount(choicesScreen(draftOf({ accountId: 7, assumptions: { annualReturnPct: "5", inflationPct: "2" } }))); type(field(RETIREMENT_FIELDS.retirementMonth), "2055-03"); click(primary());
    expect(h.onChoices.mock.calls[0][0]).toMatchObject({ step: "complete", questionAssumptions: { annualReturnPct: "5", inflationPct: "2" } });
  });
  it("shows only what the draft is missing and in the contract's order", () => {
    mount(choicesScreen(draftOf({ extra: { kind: null, amount: null }, startDate: null })));
    const legends = [...dialog().querySelectorAll("legend, label.modal-field > span")].map(n => n.textContent ?? "");
    expect(legends.findIndex(t => t.includes("Which investment account"))).toBeLessThan(legends.findIndex(t => t === "Extra amount (dollars)"));
    expect(legends.findIndex(t => t === "Extra amount (dollars)")).toBeLessThan(legends.findIndex(t => t.includes("each month, or just once")));
  });
  it("reports the typed values of an earlier card only for the same screen: a new draft starts empty", () => {
    const h = mount(choicesScreen(draftOf({ extra: { kind: "monthly", amount: null } }))); click(option("Fictional IRA")); type(field("Extra amount (dollars)"), "40");
    h.render(choicesScreen(draftOf({ extra: { kind: "monthly", amount: null }, sourceText: "what if I added extra to my retirement" }))); expect(field("Extra amount (dollars)").value).toBe(""); expect(option("Fictional IRA").checked).toBe(false);
  });
  it("Close dismisses without reporting anything", () => { const h = mount(choicesScreen(draftOf())); click(button("Close")); expect(h.onClose).toHaveBeenCalledTimes(1); expect(h.onChoices).not.toHaveBeenCalled(); });
});

describe("D4 reading", () => {
  it("says nothing has been calculated, offers Cancel only and announces politely", () => {
    const h = mount({ stage: "reading", accountName: "Fictional IRA" });
    expect(text()).toContain("Reading Fictional IRA… Nothing has been calculated yet."); expect(allButtons().map(b => b.textContent)).toEqual(["Cancel"]); expect(dialog().querySelector('[role="status"]')).not.toBeNull();
    click(button("Cancel")); expect(h.onClose).toHaveBeenCalledTimes(1);
  });
  it("names the account generically when none is known", () => { mount({ stage: "reading", accountName: null }); expect(text()).toContain("Reading your investment account… Nothing has been calculated yet."); });
});

describe("D5 the review card and the consent it builds", () => {
  it("shows the facts and one primary action for a complete saved plan, and confirms exactly the hand-example scenario", () => {
    const h = mount({ stage: "review", review: reviewOf() });
    expect(dialog().querySelector("h2")!.textContent).toBe("Use your saved plan?");
    const facts = Object.fromEntries([...dialog().querySelectorAll(".scenario-term")].map(t => [t.querySelector("dt")!.textContent, t.querySelector("dd")!.textContent]));
    expect(facts["Account"]).toBe("Fictional IRA"); expect(facts["Return"]).toMatch(/12% a year.*saved in your plan/i); expect(facts["Adding now"]).toContain("$100");
    expect(primary().textContent).toBe("Use my saved plan"); click(primary());
    expect(h.onConfirm).toHaveBeenCalledTimes(1); expect(confirmed(h)).toEqual(examples()[0].input);
    expect(validateConfirmedRetirementScenario(confirmed(h), { ...liveFor(confirmed(h)), source: confirmed(h).context.source })).toEqual({ ok: true });
  });
  it("hands out a copy: changing it does not change what the dialog holds", () => {
    const review = reviewOf(), h = mount({ stage: "review", review }); click(primary()); confirmed(h).intent.extra.amount = "999"; expect(review.intent.extra.amount).toBe("50");
  });
  it("a double click confirms once until the screen changes, and a disabled action confirms nothing", () => {
    const h = mount({ stage: "review", review: reviewOf() }); click(primary()); click(primary()); expect(h.onConfirm).toHaveBeenCalledTimes(1); expect(primary().disabled).toBe(true);
    h.render({ stage: "review", review: reviewOf(r => { r.intent.extra.amount = "60"; }) }); expect(primary().disabled).toBe(false); click(primary()); expect(h.onConfirm).toHaveBeenCalledTimes(2); expect(confirmed(h, 1).intent.extra.amount).toBe("60");
  });
  it("lists the other ways forward as secondary actions and never repeats the primary", () => {
    mount({ stage: "review", review: reviewOf() });
    expect(hasButton("Show extra deposits with no investment growth")).toBe(true); expect(hasButton("Choose a return assumption")).toBe(true); expect(allButtons().filter(b => b.textContent === "Use my saved plan").length).toBe(1);
  });
  it("exact deposits only confirms the deposits view, with no balance, return or inflation assumption", () => {
    const h = mount({ stage: "review", review: reviewOf() }); click(button("Show extra deposits with no investment growth"));
    expect(confirmed(h).assumptions).toEqual({ view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } });
  });
  describe("choosing a return (edit proofs)", () => {
    it("shows an input, waits for a number, and the typed number reaches the scenario (not the saved 12)", () => {
      const h = mount({ stage: "review", review: reviewOf() }); expect(hasField(RETIREMENT_FIELDS.explicitReturn)).toBe(false);
      click(button("Choose a return assumption")); expect(hasField(RETIREMENT_FIELDS.explicitReturn)).toBe(true); expect(primary().textContent).toBe("Use this return"); expect(primary().disabled).toBe(true);
      type(field(RETIREMENT_FIELDS.explicitReturn), "5"); expect(primary().disabled).toBe(false); click(primary());
      expect(confirmed(h).assumptions.returns).toEqual({ kind: "confirmed-return", annualPct: "5", basis: "explicit", sensitivity: null });
    });
    it("each different typed value gives a different scenario", () => {
      const rates: string[] = [];
      for (const typed of ["0", "2.5", "-3", "100"]) {
        act(() => root.unmount()); root = createRoot(container); const h = mount({ stage: "review", review: reviewOf() });
        click(button("Choose a return assumption")); type(field(RETIREMENT_FIELDS.explicitReturn), typed); click(primary()); rates.push((confirmed(h).assumptions.returns as { annualPct: string }).annualPct);
      }
      expect(rates).toEqual(["0", "2.5", "-3", "100"]);
    });
    it("refuses an unusable return in words and cannot be confirmed", () => {
      const h = mount({ stage: "review", review: reviewOf() }); click(button("Choose a return assumption"));
      for (const bad of ["150", "-101", "abc", "", "5%", "1e2"]) { type(field(RETIREMENT_FIELDS.explicitReturn), bad); expect(primary().disabled, bad).toBe(true); if (bad !== "") expect(problems(), bad).toEqual([RETIREMENT_PROBLEMS.return]); }
      click(primary()); expect(h.onConfirm).not.toHaveBeenCalled();
    });
  });
  describe("today's dollars (edit proofs)", () => {
    it("offers the saved inflation as a prefilled candidate and confirms the typed value", () => {
      const h = mount({ stage: "review", review: reviewOf() }); expect(option(RETIREMENT_FIELDS.futureDollars).checked).toBe(true); expect(hasField(RETIREMENT_FIELDS.inflation)).toBe(false);
      click(option(RETIREMENT_FIELDS.todaysDollars)); expect(field(RETIREMENT_FIELDS.inflation).value).toBe("3");
      type(field(RETIREMENT_FIELDS.inflation), "2"); click(primary()); expect(confirmed(h).assumptions.purchasingPower).toEqual({ kind: "today", inflationPct: "2" });
    });
    it("confirms the untouched candidate, and a stated inflation replaces the saved one as the candidate", () => {
      const h = mount({ stage: "review", review: reviewOf(r => { r.questionAssumptions = { annualReturnPct: null, inflationPct: "2" }; }) }); click(option(RETIREMENT_FIELDS.todaysDollars));
      expect(field(RETIREMENT_FIELDS.inflation).value).toBe("2"); click(button("Use my saved plan")); expect(confirmed(h).assumptions.purchasingPower).toEqual({ kind: "today", inflationPct: "2" });
    });
    it("refuses an unusable inflation in words and goes back to future dollars cleanly", () => {
      const h = mount({ stage: "review", review: reviewOf() }); click(option(RETIREMENT_FIELDS.todaysDollars));
      for (const bad of ["101", "-1", "abc", ""]) { type(field(RETIREMENT_FIELDS.inflation), bad); expect(primary().disabled, bad).toBe(true); }
      expect(problems()).toEqual([RETIREMENT_PROBLEMS.inflation]); click(option(RETIREMENT_FIELDS.futureDollars)); expect(hasField(RETIREMENT_FIELDS.inflation)).toBe(false); expect(primary().disabled).toBe(false);
      click(primary()); expect(confirmed(h).assumptions.purchasingPower).toEqual({ kind: "nominal" });
    });
    it("does not offer today's dollars when there is no recorded value", () => { mount({ stage: "review", review: reviewOf(r => { r.context.currentValue = null; }) }); expect(hasOption(RETIREMENT_FIELDS.todaysDollars)).toBe(false); });
  });
  describe("a missing recorded contribution (edit proofs)", () => {
    const none = () => reviewOf(r => { r.context.contribution = { kind: "missing" }; });
    it("asks for an amount, waits, and a typed amount (even 0) reaches the scenario as a manual amount", () => {
      const h = mount({ stage: "review", review: none() }); expect(hasField(RETIREMENT_FIELDS.manualAmount)).toBe(true); expect(primary().disabled).toBe(true); expect(problems()).toEqual([]);
      type(field(RETIREMENT_FIELDS.manualAmount), "abc"); expect(primary().disabled).toBe(true); expect(problems()).toEqual([RETIREMENT_PROBLEMS.manualAmount]);
      type(field(RETIREMENT_FIELDS.manualAmount), "0"); expect(primary().disabled).toBe(false); click(primary()); expect(confirmed(h).assumptions.monthlyContribution).toEqual({ basis: "manual", amount: "0" });
    });
    it("two typed amounts give two different calculations", () => {
      const finals: number[] = [];
      for (const typed of ["0", "100"]) {
        act(() => root.unmount()); root = createRoot(container); const h = mount({ stage: "review", review: none() }); type(field(RETIREMENT_FIELDS.manualAmount), typed); click(primary());
        const calc = calculateRetirementScenario(confirmed(h)); if (calc.kind !== "preview") throw new Error("preview expected"); finals.push(calc.noGrowth.baseline.points.at(-1)!.balance);
      }
      expect(finals[1] - finals[0]).toBe(100);
    });
    it("does not ask for an amount when one is recorded, and a typed amount cannot override it", () => { mount({ stage: "review", review: reviewOf() }); expect(hasField(RETIREMENT_FIELDS.manualAmount)).toBe(false); });
    it("exact deposits only does not need the amount", () => { const h = mount({ stage: "review", review: none() }); click(button("Show extra deposits with no investment growth")); expect(confirmed(h).assumptions.view).toBe("extra-deposits-only"); });
  });
  describe("a month taken from the plan (edit proofs)", () => {
    const fromPlan = () => reviewOf(r => { r.monthSource = "plan-candidate"; r.context.retirementMonth = r.intent.retirementMonth; });
    it("says so, offers Pick another month, and a typed month reaches the scenario and is shown as the person's", () => {
      const h = mount({ stage: "review", review: fromPlan() }); expect(text()).toMatch(/from your plan/i); click(button(RETIREMENT_COPY.pickAnotherMonth));
      expect(primary().disabled).toBe(true); type(field(RETIREMENT_FIELDS.retirementMonth), "2055-03"); expect(primary().disabled).toBe(false); expect(text()).toContain("the month you picked");
      click(primary()); expect(confirmed(h).intent.retirementMonth).toBe("2055-03");
    });
    it("refuses a past month in words, and does not confirm", () => {
      const h = mount({ stage: "review", review: fromPlan() }); click(button(RETIREMENT_COPY.pickAnotherMonth)); type(field(RETIREMENT_FIELDS.retirementMonth), "2026-09");
      expect(primary().disabled).toBe(true); expect(dialog().querySelector(".date-field-problem")?.textContent).toMatch(/Oct 2026/); click(primary()); expect(h.onConfirm).not.toHaveBeenCalled();
    });
    it("is not offered when the month came from the question or was typed", () => { for (const source of ["question", "typed"] as const) { act(() => root.unmount()); root = createRoot(container); mount({ stage: "review", review: reviewOf(r => { r.monthSource = source; }) }); expect(hasButton(RETIREMENT_COPY.pickAnotherMonth), source).toBe(false); } });
    it("shows the plan's own month when the question named another", () => { mount({ stage: "review", review: reviewOf(r => { r.context.retirementMonth = "2030-01"; }) }); expect(text()).toContain("Month in your plan"); expect(text()).toContain("January 2030"); });
  });
  describe("no usable return", () => {
    const noReturn = (kind: "application-default" | "missing") => reviewOf(r => { r.context.returnAssumption = kind === "missing" ? { kind: "missing" } : { kind, annualPct: "7" }; });
    for (const kind of ["application-default", "missing"] as const) it(`with a ${kind} return, the primary shows the balance with no investment growth and says no return was picked for the person`, () => {
      const h = mount({ stage: "review", review: noReturn(kind) });
      expect(primary().textContent).toBe(RETIREMENT_COPY.noGrowthBalance); expect(text()).toContain("No saved return was found, and I haven't picked one for you.");
      click(primary()); expect(confirmed(h).assumptions).toMatchObject({ view: "balances", returns: { kind: "no-growth" }, monthlyContribution: { basis: "context" } });
    });
    it("a default return can never be confirmed as the saved plan from this card", () => { mount({ stage: "review", review: noReturn("application-default") }); expect(hasButton("Use my saved plan")).toBe(false); });
    it("with no recorded value only exact deposits is offered, with its reason", () => {
      const h = mount({ stage: "review", review: reviewOf(r => { r.context.currentValue = null; }) });
      expect(primary().textContent).toBe(RETIREMENT_COPY.depositsOnly); expect(hasButton("Choose a return assumption")).toBe(false); expect(text()).toContain("There is no recorded value for this account, so I can only show the extra deposits.");
      click(primary()); expect(confirmed(h).assumptions.view).toBe("extra-deposits-only");
    });
  });
  describe("a return written in the question", () => {
    const asked = () => reviewOf(r => { r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; });
    it("is offered first and labelled, confirmed only by the click, with the saved plan still available", () => {
      const h = mount({ stage: "review", review: asked() }); expect(text()).toContain("Return in your question"); expect(h.onConfirm).not.toHaveBeenCalled();
      expect(primary().textContent).toBe("Use 5% a year, as you asked"); click(primary()); expect(confirmed(h).assumptions.returns).toEqual({ kind: "confirmed-return", annualPct: "5", basis: "explicit", sensitivity: null });
      act(() => root.unmount()); root = createRoot(container); const g = mount({ stage: "review", review: asked() }); click(button("Use my saved plan")); expect(confirmed(g).assumptions.returns).toMatchObject({ basis: "stored-plan", annualPct: "12" });
    });
  });
  it("does not scold before the person has typed anything, and a long account name is shown in full", () => {
    const name = "Johnson family long-term retirement and charitable giving account at a very large brokerage";
    const review = reviewOf(r => { r.context.account.name = name; r.context.contribution = { kind: "missing" }; });
    mount({ stage: "review", review }, { today: TODAY, investmentAccounts: [{ id: 7, name }] }); expect(problems()).toEqual([]); expect(text()).toContain(name);
  });
  it("typed values belong to one review: a different review starts clean, the same one keeps them", () => {
    const none = () => reviewOf(r => { r.context.contribution = { kind: "missing" }; }), h = mount({ stage: "review", review: none() });
    click(button("Choose a return assumption")); type(field(RETIREMENT_FIELDS.explicitReturn), "5"); type(field(RETIREMENT_FIELDS.manualAmount), "10");
    h.render({ stage: "review", review: none() }); expect(field(RETIREMENT_FIELDS.manualAmount).value).toBe("10");
    h.render({ stage: "review", review: reviewOf(r => { r.context.contribution = { kind: "missing" }; r.intent.extra.amount = "60"; }) }); expect(field(RETIREMENT_FIELDS.manualAmount).value).toBe(""); expect(hasField(RETIREMENT_FIELDS.explicitReturn)).toBe(false);
  });
  it("opens with the return field when asked to (returning from exact deposits)", () => { mount({ stage: "review", review: reviewOf() }, live, { openReturnChoice: true }); expect(hasField(RETIREMENT_FIELDS.explicitReturn)).toBe(true); expect(primary().textContent).toBe("Use this return"); });
  it("the confirming actions only ever hand over a scenario the shared validator accepts", () => {
    const variants: Partial<RetirementReview>[] = [{}, { questionAssumptions: { annualReturnPct: "5", inflationPct: "2" } }];
    for (const v of variants) { act(() => root.unmount()); root = createRoot(container); const h = mount({ stage: "review", review: { ...reviewOf(), ...v } }); click(primary()); const s = confirmed(h);
      expect(validateConfirmedRetirementScenario(s, { ...liveFor(s), source: s.context.source })).toEqual({ ok: true }); expect(s.confirmed).toBe(true); }
  });
});

describe("D6 the result", () => {
  const rows = () => [...dialog().querySelectorAll("table tbody tr")].map(tr => [...tr.children].map(c => c.textContent));
  it("shows the labelled rows, the date caption, the span, the exact deposits and the details for the hand example", () => {
    mount({ stage: "result", calculation: previewOf() });
    expect(dialog().querySelector("caption")!.textContent).toBe("Illustrative balance at November 2026");
    expect(rows()).toEqual([["No investment growth", "$1,100", "$1,200", "$50 more"], ["Using your confirmed plan return (12% a year)", "$1,100", "$1,200", "$50 more"]]);
    expect(text()).toContain("Across these two assumptions, the balance with the extra rounds to the same amount: $1,200."); expect(text()).toContain("Extra deposits: $50.00 in total (exact, before any growth).");
    expect(text()).toMatch(/Taxes, fees, an employer match and contribution limits are not included/); expect(text()).toContain("Nothing in your accounts was changed."); expect(text()).toContain("These are illustrations, not predictions.");
    expect(dialog().querySelector("h2")!.textContent).toBe("Adding $50 each month to Fictional IRA"); expect(text()).toContain("Shown in future dollars, not adjusted for inflation.");
  });
  it("is an accessible table: a caption, column headers and row headers", () => {
    mount({ stage: "result", calculation: previewOf() }); const table = dialog().querySelector("table")!;
    expect([...table.querySelectorAll("thead th")].every(th => th.getAttribute("scope") === "col")).toBe(true); expect([...table.querySelectorAll("tbody th")].every(th => th.getAttribute("scope") === "row")).toBe(true);
    expect(dialog().querySelector(".retirement-table-wrap")).not.toBeNull();
  });
  it("shows only the no-growth row and the no-forecast line when no return was confirmed, and offers no exploring", () => {
    mount({ stage: "result", calculation: previewOf(s => { s.assumptions.returns = { kind: "no-growth" }; }) });
    expect(rows().map(r => r[0])).toEqual(["No investment growth"]); expect(text()).toContain("No investment growth forecast was made."); expect(text()).not.toContain("Using your confirmed plan return"); expect(hasButton("Explore other returns")).toBe(false);
  });
  it("shows a tiny positive change as less than $10 with its direction, and an exact zero as no change", () => {
    mount({ stage: "result", calculation: previewOf(s => { s.context.currentValue = "0"; s.context.contribution = { kind: "saved", monthlyAmount: "0" }; s.assumptions.monthlyContribution = { basis: "context", amount: "0" }; s.intent.extra.amount = "0.04"; s.assumptions.returns = { kind: "no-growth" }; }) });
    expect(rows()[0][3]).toBe("less than $10 more");
    act(() => root.unmount()); root = createRoot(container); mount({ stage: "result", calculation: previewOf(s => { s.intent.extra.amount = "0"; }) }); expect(rows()[0][3]).toBe("no change");
  });
  it("shows a negative recorded value with a minus sign", () => { mount({ stage: "result", calculation: previewOf(s => { s.context.currentValue = "-1050"; s.assumptions.returns = { kind: "no-growth" }; }) }); expect(rows()[0].slice(1, 3)).toEqual(["-$950", "-$900"]); });
  it("names today's dollars and the inflation used for both figures", () => {
    mount({ stage: "result", calculation: previewOf(s => { s.intent.retirementMonth = "2027-10"; s.assumptions.purchasingPower = { kind: "today", inflationPct: "3" }; }) });
    expect(text()).toMatch(/Shown in today's dollars, using 3% inflation a year for both figures\./); expect(text()).toContain("$600.00");
  });
  it("shows a one-time deposit as once, with its exact total", () => { mount({ stage: "result", calculation: previewOf(s => { s.intent.extra = { kind: "once", amount: "5000" }; }) }); expect(dialog().querySelector("h2")!.textContent).toContain("$5,000 once"); expect(text()).toContain("$5,000.00"); });
  it("shows a zero-month horizon (this month) without inventing growth", () => { mount({ stage: "result", calculation: previewOf(s => { s.intent.retirementMonth = "2026-10"; }) }); expect(dialog().querySelector("caption")!.textContent).toBe("Illustrative balance at October 2026"); expect(text()).toContain("$0.00"); });
  it("shows a long account name in full", () => {
    const name = "Johnson family long-term retirement and charitable giving account at a very large brokerage";
    mount({ stage: "result", calculation: previewOf(s => { s.context.account.name = name; }) }, { today: TODAY, investmentAccounts: [{ id: 7, name }] }); expect(dialog().querySelector("h2")!.textContent).toContain(name);
  });
  it("offers Explore other returns when it can work, which asks the owner of the flow to open it, and Change the details", () => {
    const h = mount({ stage: "result", calculation: previewOf() }); click(button("Explore other returns")); expect(h.onExplore).toHaveBeenCalledTimes(1); expect(h.onConfirm).not.toHaveBeenCalled();
    expect(primary().textContent).toBe("Change the details"); click(primary()); expect(h.onEdit).toHaveBeenCalledTimes(1); expect(h.onEdit.mock.calls[0]).toEqual([]);
  });
  it("shows the optional returns tied to the entered rates and does not offer exploring again", () => {
    mount({ stage: "result", calculation: previewOf(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "-5", base: "12", higher: "20" } }; }) });
    expect(text()).toContain("Other returns, based on the rates you entered"); expect(rows().map(r => r[0])).toEqual(["No investment growth", "Using your confirmed plan return (12% a year)", "At -5% a year", "At 12% a year", "At 20% a year"]); expect(hasButton("Explore other returns")).toBe(false);
  });
  it("announces the result politely, and the first result is not blocked by exploring", () => { mount({ stage: "result", calculation: previewOf() }); expect(dialog().querySelector('[role="status"]')).not.toBeNull(); expect(document.querySelector("table")).not.toBeNull(); });
});

describe("D7 exploring other returns", () => {
  const explore = (pct = "12") => ({ stage: "explore", calculation: previewOf(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: pct, basis: "stored-plan", sensitivity: null }; s.context.returnAssumption = { kind: "stored-plan", annualPct: pct }; }) }) as RetirementScreen;
  it("explains the rates are the person's own and starts three points either side of the confirmed rate, which is read-only", () => {
    mount(explore()); expect(text()).toContain("These are rates you choose."); expect(dialog().querySelector("h2")!.textContent).toBe("Explore other returns");
    expect(field("Lower return (% a year)").value).toBe("9"); expect(field("Higher return (% a year)").value).toBe("15"); const base = field("Your confirmed return (% a year)"); expect(base.value).toBe("12"); expect(base.readOnly).toBe(true);
  });
  it("starts with clean decimals for a fractional confirmed rate", () => { mount(explore("6.1")); expect(field("Lower return (% a year)").value).toBe("3.1"); expect(field("Higher return (% a year)").value).toBe("9.1"); });
  it("confirms the edited rates, which reach the scenario (not the defaults)", () => {
    const h = mount(explore()); type(field("Lower return (% a year)"), "2"); type(field("Higher return (% a year)"), "20"); expect(primary().textContent).toBe("Show these returns"); expect(primary().disabled).toBe(false); click(primary());
    expect(h.onConfirm).toHaveBeenCalledTimes(1); expect(confirmed(h).assumptions.returns).toMatchObject({ annualPct: "12", sensitivity: { lower: "2", base: "12", higher: "20" } });
    expect(confirmed(h).intent).toEqual(examples()[0].input.intent);
  });
  it("confirms the untouched defaults too", () => { const h = mount(explore()); click(primary()); expect(confirmed(h).assumptions.returns).toMatchObject({ sensitivity: { lower: "9", base: "12", higher: "15" } }); });
  it("explains an unusable pair in words and cannot be confirmed", () => {
    const h = mount(explore());
    for (const [lo, hi] of [["13", "15"], ["9", "11"], ["150", "15"], ["9", "101"], ["abc", "15"], ["", "15"], ["9", ""], ["-101", "15"]]) {
      type(field("Lower return (% a year)"), lo); type(field("Higher return (% a year)"), hi); expect(primary().disabled, `${lo}/${hi}`).toBe(true); expect(problems(), `${lo}/${hi}`).toEqual([RETIREMENT_PROBLEMS.otherReturns]);
    }
    type(field("Lower return (% a year)"), "-100"); type(field("Higher return (% a year)"), "100"); expect(primary().disabled).toBe(false); expect(problems()).toEqual([]); click(primary()); expect(confirmed(h).assumptions.returns).toMatchObject({ sensitivity: { lower: "-100", higher: "100" } });
  });
  it("lets the person go back to the result or close, reporting nothing else", () => {
    const h = mount(explore()); click(button(RETIREMENT_COPY.backToResult)); expect(h.onBack).toHaveBeenCalledTimes(1); click(button("Close")); expect(h.onClose).toHaveBeenCalledTimes(1); expect(h.onConfirm).not.toHaveBeenCalled();
  });
  it("cannot confirm other returns when no return was confirmed, and says why", () => {
    const h = mount({ stage: "explore", calculation: previewOf(s => { s.assumptions.returns = { kind: "no-growth" }; }) }); expect(primary().disabled).toBe(true); expect(text()).toContain("Other returns need a confirmed return first."); click(primary()); expect(h.onConfirm).not.toHaveBeenCalled();
  });
  it("a double click confirms once until the screen changes", () => { const h = mount(explore()); click(primary()); click(primary()); expect(h.onConfirm).toHaveBeenCalledTimes(1); });
});

describe("D8 exact deposits only", () => {
  it("shows the exact total, says no growth forecast was made, and offers choosing a return as its primary when a value is recorded", () => {
    const h = mount({ stage: "deposits-only", calculation: depositsOf() });
    expect(text()).toContain("Extra deposits: $50.00 in total (exact)."); expect(text()).toContain("No investment growth forecast was made."); expect(document.querySelector("table")).toBeNull(); expect(text()).not.toMatch(/Illustrative balance|Using your confirmed plan return|Across these two/);
    expect(primary().textContent).toBe("Choose a return assumption"); click(primary()); expect(h.onEdit).toHaveBeenCalledTimes(1); expect(h.onEdit.mock.calls[0]).toEqual([{ chooseReturn: true }]);
  });
  it("with no recorded value offers no return: the primary is Change the details and leads somewhere", () => {
    const h = mount({ stage: "deposits-only", calculation: depositsOf(s => { s.context.currentValue = null; }) });
    expect(text()).not.toContain("Choose a return assumption"); expect(primary().textContent).toBe("Change the details"); click(primary()); expect(h.onEdit.mock.calls[0]).toEqual([]);
  });
  it("a recorded zero value still allows choosing a return", () => { mount({ stage: "deposits-only", calculation: depositsOf(s => { s.context.currentValue = "0"; }) }); expect(primary().textContent).toBe("Choose a return assumption"); });
});

describe("D9 needs attention, not supported, changed and error", () => {
  it("shows a refusal's reason, then Change the details", () => {
    const h = mount({ stage: "blocked", calculation: { kind: "refused", code: "unsupported-number", message: "Choose usable assumptions." } });
    expect(text()).toContain("Choose usable assumptions."); expect(text()).toContain("Nothing was calculated."); expect(dialog().querySelector('[role="alert"]')).not.toBeNull(); click(primary()); expect(h.onEdit).toHaveBeenCalledTimes(1);
  });
  for (const code of UNSUPPORTED_CODES) it(`shows the sentence for the unsupported reason "${code}" and a way out`, () => {
    const h = mount({ stage: "unsupported", reason: retirementUnsupportedMessage(code) }); expect(text()).toContain(retirementUnsupportedMessage(code)); expect(primary().textContent).toBe("Ask something else"); click(primary()); expect(h.onClose).toHaveBeenCalledTimes(1);
  });
  for (const stage of ["stale", "error"] as const) it(`the ${stage} card shows its message as an alert and offers Try again`, () => {
    const h = mount({ stage, message: "Your accounts changed. Ask again." }); expect(text()).toContain("Your accounts changed. Ask again."); expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
    expect(dialog().querySelector("h2")!.textContent).toBe(RETIREMENT_ANNOUNCEMENTS[stage].heading); click(primary()); expect(h.onRestart).toHaveBeenCalledTimes(1); click(button("Close")); expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("D10 wording", () => {
  const screens = (): RetirementScreen[] => [
    choicesScreen(draftOf()), choicesScreen(draftOf({ accountId: 7, startDate: null }), live.investmentAccounts, "2050-06"), { stage: "reading", accountName: null }, { stage: "review", review: reviewOf() },
    { stage: "review", review: reviewOf(r => { r.context.returnAssumption = { kind: "missing" }; r.context.contribution = { kind: "missing" }; }) }, { stage: "review", review: reviewOf(r => { r.context.currentValue = null; }) },
    { stage: "review", review: reviewOf(r => { r.questionAssumptions = { annualReturnPct: "5", inflationPct: "2" }; r.monthSource = "typed"; }) }, { stage: "result", calculation: previewOf() },
    { stage: "result", calculation: previewOf(s => { s.assumptions.returns = { kind: "no-growth" }; }) }, { stage: "result", calculation: previewOf(s => { s.assumptions.purchasingPower = { kind: "today", inflationPct: "3" }; s.intent.retirementMonth = "2036-10"; }) },
    { stage: "result", calculation: previewOf(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "5", basis: "explicit", sensitivity: { lower: "-100", base: "5", higher: "100" } }; }) },
    { stage: "explore", calculation: previewOf() }, { stage: "deposits-only", calculation: depositsOf() }, { stage: "deposits-only", calculation: depositsOf(s => { s.context.currentValue = null; }) },
    { stage: "blocked", calculation: { kind: "refused", code: "unsupported-number", message: "Choose usable assumptions." } }, { stage: "unsupported", reason: retirementUnsupportedMessage("income") },
    { stage: "stale", message: "Your accounts changed. Ask again." }, { stage: "error", message: "I couldn't read that account right now." },
  ];
  it("never uses forbidden wording, engineering words or unfilled values in any state", () => {
    for (const [i, screen] of screens().entries()) {
      act(() => root.unmount()); root = createRoot(container); mount(screen); const shown = dialog().textContent ?? "";
      expect(shown, `screen ${i} (${screen.stage})`).not.toMatch(FORBIDDEN_RETIREMENT_WORDING);
      expect(shown, `screen ${i} (${screen.stage})`).not.toMatch(/\bundefined\b|\bNaN\b|\[object|\bnull\b|nominal|stored-plan|application-default|payload|revision/i);
    }
  });
  it("offers no Apply, Save, Export, Copy or Share control in any state", () => {
    for (const [i, screen] of screens().entries()) { act(() => root.unmount()); root = createRoot(container); mount(screen); for (const b of allButtons()) expect(b.textContent, `screen ${i}`).not.toMatch(/\b(apply|save|export|copy|share|download|print|send|connect)\b/i); }
  });
});

describe("D11 accessibility semantics", () => {
  const stages = (): RetirementScreen[] => [
    choicesScreen(draftOf({ extra: { kind: null, amount: null }, startDate: null })), choicesScreen(draftOf({ accountId: 7 }), live.investmentAccounts, "2050-06"), { stage: "reading", accountName: "Fictional IRA" },
    { stage: "review", review: reviewOf(r => { r.context.contribution = { kind: "missing" }; r.monthSource = "plan-candidate"; r.context.retirementMonth = r.intent.retirementMonth; }) }, { stage: "result", calculation: previewOf() },
    { stage: "explore", calculation: previewOf() }, { stage: "deposits-only", calculation: depositsOf() }, { stage: "blocked", calculation: { kind: "refused", code: "invalid-input", message: "Choose usable assumptions." } },
    { stage: "unsupported", reason: retirementUnsupportedMessage("tax") }, { stage: "stale", message: "Changed." }, { stage: "error", message: "Problem." },
  ];
  it("is one titled dialog, and the title is the state's heading", () => {
    for (const screen of stages()) { act(() => root.unmount()); root = createRoot(container); mount(screen); const d = dialog(); const id = d.getAttribute("aria-labelledby")!; expect(document.getElementById(id)?.textContent?.length, screen.stage).toBeGreaterThan(4); expect(document.querySelectorAll('[role="dialog"]').length).toBe(1); }
  });
  it("gives every field, radio, checkbox and menu a visible, persistent name", () => {
    for (const screen of stages()) {
      act(() => root.unmount()); root = createRoot(container); mount(screen);
      for (const input of dialog().querySelectorAll<HTMLInputElement>("input")) {
        if (input.readOnly && input.closest("label")) continue;
        const named = input.closest("label")?.textContent?.trim() || input.getAttribute("aria-label") || ""; expect(named.length, `${screen.stage} ${input.type}`).toBeGreaterThan(1);
      }
    }
  });
  it("uses one primary action in every state and no unnamed button", () => {
    for (const screen of stages()) { act(() => root.unmount()); root = createRoot(container); mount(screen); expect(dialog().querySelectorAll(".modal-actions button:not(.modal-secondary)").length, screen.stage).toBe(1); for (const b of allButtons()) expect((b.textContent?.trim() || b.getAttribute("aria-label") || "").trim().length, screen.stage).toBeGreaterThan(0); }
  });
  it("follows the announcement table: alerts for needs attention, changed and error; polite status for reading, result and exact deposits", () => {
    const live_ = (screen: RetirementScreen) => { act(() => root.unmount()); root = createRoot(container); mount(screen); return { alert: dialog().querySelector('[role="alert"]') !== null, status: dialog().querySelector('[role="status"]') !== null }; };
    for (const screen of stages()) {
      const want = RETIREMENT_ANNOUNCEMENTS[screen.stage === "unsupported" ? "unsupported" : screen.stage].live, got = live_(screen);
      if (want === "alert") expect(got.alert, screen.stage).toBe(true); if (want === "status") expect(got.status, screen.stage).toBe(true); if (want === "none") expect(got.alert, screen.stage).toBe(false);
    }
  });
  it("moves focus into the dialog when the state changes, and Escape closes without reporting anything", () => {
    const h = mount({ stage: "reading", accountName: "Fictional IRA" }); expect(dialog().contains(document.activeElement)).toBe(true);
    h.render({ stage: "review", review: reviewOf() }); expect(dialog().contains(document.activeElement)).toBe(true);
    act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); expect(h.onClose).toHaveBeenCalledTimes(1); expect(h.onConfirm).not.toHaveBeenCalled();
  });
  it("keeps focus in the dialog after one state replaces another, once the earlier state's deferred focus restore has run", () => {
    vi.useFakeTimers();
    try {
      const outside = document.createElement("input"); document.body.appendChild(outside); outside.focus();
      const h = mount({ stage: "reading", accountName: null });
      h.render(choicesScreen(draftOf()));
      act(() => { vi.advanceTimersByTime(50); });
      expect(dialog().contains(document.activeElement), `focus is on ${document.activeElement?.tagName}`).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("keeps every control reachable by keyboard (no positive tabindex, no disabled-only path to a state)", () => {
    for (const screen of stages()) { act(() => root.unmount()); root = createRoot(container); mount(screen); expect([...dialog().querySelectorAll("[tabindex]")].every(n => Number(n.getAttribute("tabindex")) <= 0), screen.stage).toBe(true); }
  });
});

describe("D12 nothing typed carries over, and a result is never edited in place", () => {
  it("a result screen has no editable field for the consented terms", () => { mount({ stage: "result", calculation: previewOf() }); expect(dialog().querySelectorAll("input").length).toBe(0); });
  it("going from a result to a review starts the review clean", () => {
    const h = mount({ stage: "review", review: reviewOf(r => { r.context.contribution = { kind: "missing" }; }) }); type(field(RETIREMENT_FIELDS.manualAmount), "77");
    h.render({ stage: "result", calculation: previewOf() }); h.render({ stage: "review", review: reviewOf(r => { r.context.contribution = { kind: "missing" }; }) }); expect(field(RETIREMENT_FIELDS.manualAmount).value).toBe("");
  });
});

describe("D15 read-only and session-only", () => {
  it("touches no storage, network or native bridge through complete flows", () => {
    const store = vi.spyOn(Storage.prototype, "setItem"), read = vi.spyOn(Storage.prototype, "getItem"), net = vi.fn(), realFetch = (globalThis as { fetch?: unknown }).fetch; (globalThis as { fetch?: unknown }).fetch = net;
    const bridge = { invoke: vi.fn() }; (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = bridge;
    const h = mount({ stage: "review", review: reviewOf() }); click(button("Choose a return assumption")); type(field(RETIREMENT_FIELDS.explicitReturn), "5"); click(primary());
    act(() => root.unmount()); root = createRoot(container); mount({ stage: "explore", calculation: previewOf() }); click(primary());
    expect(store).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(net).not.toHaveBeenCalled(); expect(bridge.invoke).not.toHaveBeenCalled(); expect(h.onConfirm).toHaveBeenCalled();
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__; (globalThis as { fetch?: unknown }).fetch = realFetch;
  });
  it("the component's source imports no storage, network, native or write path", () => {
    const source = readFileSync(join(process.cwd(), "src", "RetirementScenarioDialog.tsx"), "utf8");
    for (const banned of [/@tauri-apps/, /financialReads/, /\binvoke\s*\(/, /localStorage/, /sessionStorage/, /indexedDB/, /\bfetch\s*\(/, /XMLHttpRequest/, /navigator\.(clipboard|sendBeacon)/, /document\.title\s*=/, /history\.(push|replace)State/, /location\.(hash|href)\s*=/]) expect(source, String(banned)).not.toMatch(banned);
  });
});

describe("D13 two clicks before the screen can update still act once", () => {
  const twice = (el: Element) => act(() => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
  it("the review's confirming action", () => { const h = mount({ stage: "review", review: reviewOf() }); twice(primary()); expect(h.onConfirm).toHaveBeenCalledTimes(1); });
  it("a secondary confirming action", () => { const h = mount({ stage: "review", review: reviewOf() }); twice(button("Show extra deposits with no investment growth")); expect(h.onConfirm).toHaveBeenCalledTimes(1); });
  it("the choices card's Continue", () => { const h = mount(choicesScreen(draftOf())); click(option("Fictional IRA")); twice(primary()); expect(h.onChoices).toHaveBeenCalledTimes(1); });
  it("exploring other returns", () => {
    const h = mount({ stage: "explore", calculation: previewOf() }); twice(primary()); expect(h.onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("interacting conditions found in the adversarial pass", () => {
  it("accepts a typed inflation of zero and confirms it as zero (not as missing or the default)", () => {
    const h = mount({ stage: "review", review: reviewOf() }); click(option(RETIREMENT_FIELDS.todaysDollars)); type(field(RETIREMENT_FIELDS.inflation), "0");
    expect(primary().disabled).toBe(false); click(primary()); expect(confirmed(h).assumptions.purchasingPower).toEqual({ kind: "today", inflationPct: "0" });
  });
  it("with no saved inflation the field starts empty and must be filled before today's dollars can be confirmed", () => {
    const h = mount({ stage: "review", review: reviewOf(r => { r.inflation = { kind: "missing" }; }) }); click(option(RETIREMENT_FIELDS.todaysDollars));
    expect(field(RETIREMENT_FIELDS.inflation).value).toBe(""); expect(primary().disabled).toBe(true); type(field(RETIREMENT_FIELDS.inflation), "2.5"); click(primary());
    expect(confirmed(h).assumptions.purchasingPower).toEqual({ kind: "today", inflationPct: "2.5" });
  });
  it("a question that already gave the month and the account but not the amount asks only for the amount, and reports the month as the question's", () => {
    const h = mount(choicesScreen(draftOf({ accountId: 7, extra: { kind: "monthly", amount: null }, retirementMonth: "2050-06" })));
    expect(hasField("Extra amount (dollars)")).toBe(true); expect(hasField(RETIREMENT_FIELDS.retirementMonth)).toBe(false); expect(primary().disabled).toBe(true);
    type(field("Extra amount (dollars)"), "20"); click(primary());
    expect(h.onChoices.mock.calls[0][0]).toMatchObject({ step: "complete", monthSource: "question", intent: { accountId: 7, extra: { kind: "monthly", amount: "20" }, retirementMonth: "2050-06" } });
  });
  it("a stated later start with a known account is acknowledged and reported as today, with the typed month", () => {
    const h = mount(choicesScreen(draftOf({ accountId: 7, startDate: null })));
    type(field(RETIREMENT_FIELDS.retirementMonth), "2055-03"); expect(primary().disabled).toBe(true); click(option("Start today instead")); expect(primary().disabled).toBe(false); click(primary());
    expect(h.onChoices.mock.calls[0][0]).toMatchObject({ step: "complete", monthSource: "typed", intent: { startDate: TODAY, retirementMonth: "2055-03" } });
  });
  it("Escape on the choices card closes it and reports nothing", () => {
    const h = mount(choicesScreen(draftOf())); act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(h.onClose).toHaveBeenCalledTimes(1); expect(h.onChoices).not.toHaveBeenCalled();
  });
  it("a screen whose roster the live context no longer matches is replaced by the safe message even mid-typing", () => {
    const none = () => reviewOf(r => { r.context.contribution = { kind: "missing" }; }), h = mount({ stage: "review", review: none() }); type(field(RETIREMENT_FIELDS.manualAmount), "10");
    h.render({ stage: "review", review: none() }, { today: TODAY, investmentAccounts: [{ id: 7, name: "Renamed" }] }); expect(text()).toContain(RETIREMENT_INVALID_SCREEN_MESSAGE); expect(hasField(RETIREMENT_FIELDS.manualAmount)).toBe(false);
  });
});

describe("found by reading the final source", () => {
  const fromPlan = () => reviewOf(r => { r.monthSource = "plan-candidate"; r.context.retirementMonth = r.intent.retirementMonth; });
  it("while another month is being picked, no action confirms until a usable month is typed (a secondary action must not use the plan's month behind the person's back)", () => {
    const h = mount({ stage: "review", review: fromPlan() }); click(button(RETIREMENT_COPY.pickAnotherMonth));
    for (const name of ["Show extra deposits with no investment growth", "Choose a return assumption"]) if (hasButton(name)) expect((button(name) as HTMLButtonElement).disabled === true || name === "Choose a return assumption", name).toBe(true);
    expect(button("Show extra deposits with no investment growth").disabled).toBe(true); expect(primary().disabled).toBe(true);
    type(field(RETIREMENT_FIELDS.retirementMonth), "2026-09"); expect(button("Show extra deposits with no investment growth").disabled).toBe(true);
    click(button("Show extra deposits with no investment growth")); expect(h.onConfirm).not.toHaveBeenCalled();
    type(field(RETIREMENT_FIELDS.retirementMonth), "2055-03"); expect(button("Show extra deposits with no investment growth").disabled).toBe(false);
    click(button("Show extra deposits with no investment growth")); expect(confirmed(h).intent.retirementMonth).toBe("2055-03");
  });
  it("moves focus to the field a button reveals, so keyboard users do not lose their place", () => {
    mount({ stage: "review", review: fromPlan() });
    click(button("Choose a return assumption")); expect(document.activeElement).toBe(field(RETIREMENT_FIELDS.explicitReturn));
    click(button(RETIREMENT_COPY.pickAnotherMonth)); expect(document.activeElement).toBe(field(RETIREMENT_FIELDS.retirementMonth));
  });
});
