import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_RETIREMENT_WORDING, RETIREMENT_COPY, RETIREMENT_PRIMARY_ACTION, RETIREMENT_STAGES, RETIREMENT_TRANSITIONS, buildRetirementConfirmation, buildRetirementReview, canTransition, retirementCompleteEvent, validateRetirementChoicesEvent,
  RETIREMENT_CHOICE_COPY, RETIREMENT_INVALID_SCREEN_MESSAGE, RETIREMENT_PROBLEMS, RETIREMENT_TABLE_HEADERS, buildExploreConfirmation, retirementDraftWithAnswers, retirementMonthUsable, retirementAccountLabels, retirementChoicesIntro, retirementReviewChoices, retirementUsePlanMonth, withRetirementMonth,
  retirementChoicePrompts, retirementDepositsOnlyContent, retirementDifferenceText, retirementExactMoneyText, retirementIllustrativeBalance, retirementMoneyText,
  RETIREMENT_ANNOUNCEMENTS, RETIREMENT_CHANGED_MESSAGE, RETIREMENT_FIELDS, retirementExploreContent, retirementMonthText, retirementReadingMessage, retirementResultContent, retirementReviewContent, retirementUnsupportedMessage,
  validateRetirementScreen, retirementSavedMonthBeyondLimit, retirementSavedMonthLimitMessage,
} from "./retirementScreenContract";
import { UNSUPPORTED_CODES } from "./retirementCorpus";
import type { PreviewCalculation, RetirementChoices, RetirementChoicesEvent, RetirementDialogProps, RetirementReviewForm, RetirementReview, RetirementScreen, RetirementStage } from "./retirementScreenContract";
import { calculateRetirementScenario } from "./retirementScenarioMath";
import { retirementContractExamples } from "./retirementScenarioContractExamples";
import { validateConfirmedRetirementScenario, validateRetirementDraft } from "./retirementScenarioContract";
import type { ConfirmedRetirementScenario, RetirementDraft, RetirementEstimate, RetirementParseContext } from "./retirementScenarioContract";

const examples = () => retirementContractExamples();
const parse: RetirementParseContext = { today: "2026-10-17", investmentAccounts: [{ id: 7, name: "Fictional IRA" }] };
const reviewOf = (mutate: (r: RetirementReview) => void = () => {}): RetirementReview => {
  const input = examples()[0].input;
  const review: RetirementReview = { intent: input.intent, context: input.context, inflation: { kind: "stored", pct: "3" }, monthSource: "question", questionAssumptions: { annualReturnPct: null, inflationPct: null } };
  mutate(review); return review;
};
const stored: RetirementChoices = { view: "balances", contribution: { basis: "context" }, returns: { kind: "stored-plan" }, sensitivity: null, purchasingPower: { kind: "nominal" } };
const preview = (patch: (s: ConfirmedRetirementScenario) => void = () => {}): PreviewCalculation => {
  const input = examples()[0].input; patch(input);
  const result = calculateRetirementScenario(input);
  if (result.kind !== "preview") throw new Error("expected a preview: " + JSON.stringify(result));
  return result;
};
const depositsOnly = () => {
  const input = examples()[0].input; input.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
  const result = calculateRetirementScenario(input); if (result.kind !== "extra-deposits-only") throw new Error("expected deposits only"); return result;
};
const draft = (over: Partial<RetirementDraft> = {}): RetirementDraft => ({ sourceText: "what if I saved an extra $50 a month", accountId: null, extra: { kind: "monthly", amount: "50" }, startDate: null, retirementMonth: null,
  assumptions: { annualReturnPct: null, inflationPct: null }, missing: ["account", "start-date", "retirement-month"], hints: [], ...over });
const screens = (): Record<string, RetirementScreen> => ({
  choices: { stage: "choices", draft: draft(), accounts: parse.investmentAccounts, today: parse.today, monthCandidate: null, savedMonthLimit: null },
  reading: { stage: "reading", accountName: "Fictional IRA" },
  review: { stage: "review", review: reviewOf() },
  result: { stage: "result", calculation: preview() },
  "deposits-only": { stage: "deposits-only", calculation: depositsOnly() },
  blocked: { stage: "blocked", calculation: { kind: "refused", code: "unsupported-number", message: "Choose usable assumptions." } },
  explore: { stage: "explore", calculation: preview() },
  unsupported: { stage: "unsupported", reason: "Retirement income is not something I can estimate yet." },
  stale: { stage: "stale", message: "Your accounts changed. Ask again." },
  error: { stage: "error", message: "I couldn't read that account right now." },
});

describe("A5-1 every screen state is defined and strictly validated", () => {
  it("has exactly the ten states", () => { expect([...RETIREMENT_STAGES].sort()).toEqual(["blocked", "choices", "deposits-only", "error", "explore", "result", "review", "reading", "stale", "unsupported"].sort()); });
  for (const [name, screen] of Object.entries(screens())) it(`accepts a valid ${name} screen`, () => { expect(validateRetirementScreen(screen, parse)).toEqual({ ok: true }); });
  it("rejects values that are not a screen", () => { for (const bad of [null, [], "result", 5, {}, { stage: "mystery" }, { stage: "result" }]) expect(validateRetirementScreen(bad, parse)).toMatchObject({ ok: false }); });
  it("rejects extra, hidden and symbol keys on every state", () => {
    for (const screen of Object.values(screens())) {
      expect(validateRetirementScreen({ ...screen, extra: true }, parse)).toMatchObject({ ok: false });
      expect(validateRetirementScreen({ ...screen, [Symbol("x")]: 1 }, parse)).toMatchObject({ ok: false });
      const hidden = { ...screen }; Object.defineProperty(hidden, "hidden", { value: 1 }); expect(validateRetirementScreen(hidden, parse)).toMatchObject({ ok: false });
    }
  });
  it("result needs a preview, deposits-only needs the deposits-only calculation, blocked needs a refusal", () => {
    expect(validateRetirementScreen({ stage: "result", calculation: depositsOnly() }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "deposits-only", calculation: preview() }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "blocked", calculation: preview() }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "explore", calculation: depositsOnly() }, parse)).toMatchObject({ ok: false });
  });
  it("a result whose terms were not confirmed or were altered is rejected, not displayed", () => {
    const calculation = preview(); (calculation.scenario as { confirmed: boolean }).confirmed = false;
    expect(validateRetirementScreen({ stage: "result", calculation }, parse)).toMatchObject({ ok: false });
    const altered = preview(); altered.scenario.intent.extra.amount = "-5";
    expect(validateRetirementScreen({ stage: "result", calculation: altered }, parse)).toMatchObject({ ok: false });
  });
  it("a deposits-only result may not carry balance assumptions", () => {
    const calculation = depositsOnly(); calculation.scenario.assumptions.monthlyContribution = { basis: "manual", amount: "5" };
    expect(validateRetirementScreen({ stage: "deposits-only", calculation }, parse)).toMatchObject({ ok: false });
    const grew = depositsOnly(); (grew as { growthForecastMade: boolean }).growthForecastMade = true;
    expect(validateRetirementScreen({ stage: "deposits-only", calculation: grew }, parse)).toMatchObject({ ok: false });
  });
  it("a result's display unit must match its inflation choice", () => {
    const calculation = preview(); (calculation as { displayUnit: string }).displayUnit = "today-dollars";
    expect(validateRetirementScreen({ stage: "result", calculation }, parse)).toMatchObject({ ok: false });
  });
  it("choices must carry a valid draft against the live roster and today", () => {
    const base = screens().choices as Extract<RetirementScreen, { stage: "choices" }>;
    expect(validateRetirementScreen({ ...base, draft: draft({ accountId: 99 }) }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ ...base, draft: draft({ missing: [] }) }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ ...base, draft: draft({ hints: [{ field: "account", text: "nope", start: 0, end: 4 }] }) }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ ...base, today: "2026-10-18" }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ ...base, accounts: [{ id: 8, name: "Other" }] }, parse)).toMatchObject({ ok: false });
  });
  it("a choices screen with nothing left to choose is not a choices screen", () => {
    const base = screens().choices as Extract<RetirementScreen, { stage: "choices" }>;
    expect(validateRetirementScreen({ ...base, draft: draft({ accountId: 7, startDate: parse.today, retirementMonth: "2050-06", missing: [] }) }, parse)).toMatchObject({ ok: false });
  });
  it("a review must be internally consistent: same account, same day, valid candidate", () => {
    const wrongAccount = reviewOf(r => { r.intent.accountId = 8; });
    expect(validateRetirementScreen({ stage: "review", review: wrongAccount }, parse)).toMatchObject({ ok: false });
    const otherDay = reviewOf(r => { r.intent.startDate = "2026-10-18"; });
    expect(validateRetirementScreen({ stage: "review", review: otherDay }, parse)).toMatchObject({ ok: false });
    const badCandidate = reviewOf(r => { r.inflation = { kind: "stored", pct: "101" }; });
    expect(validateRetirementScreen({ stage: "review", review: badCandidate }, parse)).toMatchObject({ ok: false });
    const outsideRoster = { stage: "review", review: reviewOf() } as RetirementScreen;
    expect(validateRetirementScreen(outsideRoster, { ...parse, investmentAccounts: [{ id: 8, name: "Other" }] })).toMatchObject({ ok: false });
  });
  it("messages must be present, plain and short", () => {
    for (const stage of ["stale", "error"] as const) {
      expect(validateRetirementScreen({ stage, message: " " }, parse)).toMatchObject({ ok: false });
      expect(validateRetirementScreen({ stage, message: "x".repeat(301) }, parse)).toMatchObject({ ok: false });
    }
    expect(validateRetirementScreen({ stage: "unsupported", reason: "" }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "reading", accountName: " " }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "reading", accountName: null }, parse)).toEqual({ ok: true });
  });
});

describe("A5-1/A5-7 one primary action per state and the allowed transitions", () => {
  it("names exactly one plain primary action for every state", () => {
    expect(Object.keys(RETIREMENT_PRIMARY_ACTION).sort()).toEqual([...RETIREMENT_STAGES].sort());
    for (const label of Object.values(RETIREMENT_PRIMARY_ACTION)) { expect(label.trim().length).toBeGreaterThan(2); expect(label).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); expect(label).not.toMatch(/submit|execute|payload|nominal/i); }
  });
  it("defines transitions only between known states", () => {
    for (const [from, tos] of Object.entries(RETIREMENT_TRANSITIONS)) { expect(RETIREMENT_STAGES).toContain(from); for (const to of tos) expect(RETIREMENT_STAGES).toContain(to); }
  });
  it("a changed profile, account or date can retire any state that shows or gathers information", () => {
    for (const from of RETIREMENT_STAGES.filter(s => !["stale", "error"].includes(s))) { expect(canTransition(from, "stale")).toBe(true); expect(canTransition(from, "error")).toBe(true); }
  });
  it("no result can appear without passing through the review (consent) state", () => {
    const reach = (blocked: RetirementStage) => { const seen = new Set<RetirementStage>(["choices"]); const queue: RetirementStage[] = ["choices"];
      while (queue.length) { const at = queue.shift()!; for (const to of RETIREMENT_TRANSITIONS[at]) if (to !== blocked && !seen.has(to)) { seen.add(to); queue.push(to); } } return seen; };
    expect(reach("review").has("result")).toBe(false);
    expect(reach("review").has("deposits-only")).toBe(false);
    expect(reach("review").has("explore")).toBe(false);
    expect(reach("review").has("blocked")).toBe(false);
    expect(reach("reading").has("review")).toBe(false);
    const all = reach("none" as RetirementStage); for (const stage of RETIREMENT_STAGES) expect(all.has(stage)).toBe(true);
  });
  it("results come only from the review or the optional exploration, and exploration never blocks the first result", () => {
    expect(RETIREMENT_STAGES.filter(s => canTransition(s, "result")).sort()).toEqual(["explore", "review"]);
    expect(canTransition("result", "explore")).toBe(true);
    expect(canTransition("review", "explore")).toBe(false);
    expect(canTransition("explore", "result")).toBe(true);
    expect(RETIREMENT_STAGES.filter(s => canTransition(s, "deposits-only"))).toEqual(["review"]);
  });
  it("editing returns to choices or review (reconfirmation), never straight to a new result", () => {
    for (const from of ["result", "deposits-only", "blocked", "explore"] as const) { expect(canTransition(from, "choices") || canTransition(from, "review")).toBe(true); }
    expect(canTransition("choices", "result")).toBe(false);
    expect(canTransition("choices", "review")).toBe(false);
    expect(canTransition("deposits-only", "review")).toBe(true);
  });
  it("props expose consent only through onConfirm", () => {
    const props: RetirementDialogProps = { screen: screens().result, live: parse, onChoices: (event: RetirementChoicesEvent) => { void event.step; }, onConfirm: scenario => { void scenario.confirmed; }, onExplore: () => {}, onBack: () => {}, onEdit: (request?: { chooseReturn: true }) => { void request; }, onRestart: () => {}, onClose: () => {} };
    expect(Object.keys(props).filter(k => /confirm/i.test(k))).toEqual(["onConfirm"]);
  });
});

describe("A5-2 consent is built only from the reviewed terms and explicit choices", () => {
  it("builds exactly the reviewed hand-example scenario from a complete saved plan", () => {
    const built = buildRetirementConfirmation(reviewOf(), stored);
    expect(built).toEqual({ ok: true, scenario: examples()[0].input });
  });
  it("never shares objects with the review", () => {
    const review = reviewOf(); const built = buildRetirementConfirmation(review, stored); if (!built.ok) throw new Error(built.reason);
    built.scenario.intent.extra.amount = "999"; built.scenario.context.account.name = "X"; expect(review.intent.extra.amount).toBe("50"); expect(review.context.account.name).toBe("Fictional IRA");
  });
  it("every built scenario passes the existing confirmed-scenario validator", () => {
    const review = reviewOf(); const live = { today: "2026-10-17", source: review.context.source, investmentAccounts: [{ id: 7, name: "Fictional IRA" }] };
    for (const choices of [stored, { ...stored, returns: { kind: "no-growth" } }, { ...stored, returns: { kind: "explicit", annualPct: "5" } },
      { ...stored, purchasingPower: { kind: "today", inflationPct: "3" } }, { ...stored, sensitivity: { lower: "-5", base: "12", higher: "20" } },
      { ...stored, contribution: { basis: "manual", amount: "0" } }, { ...stored, view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth" } }] as RetirementChoices[]) {
      const built = buildRetirementConfirmation(review, choices); if (!built.ok) throw new Error(built.reason);
      expect(validateConfirmedRetirementScenario(built.scenario, live)).toEqual({ ok: true });
    }
  });
  it("a default return cannot be confirmed as the saved plan, but can be chosen explicitly", () => {
    const review = reviewOf(r => { r.context.returnAssumption = { kind: "application-default", annualPct: "7" }; });
    expect(buildRetirementConfirmation(review, stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(review, { ...stored, returns: { kind: "explicit", annualPct: "7" } })).toMatchObject({ ok: true });
  });
  it("a missing return allows no growth and an explicit rate but not the saved plan", () => {
    const review = reviewOf(r => { r.context.returnAssumption = { kind: "missing" }; });
    expect(buildRetirementConfirmation(review, stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(review, { ...stored, returns: { kind: "no-growth" } })).toMatchObject({ ok: true });
  });
  it("a saved 0% return is a real saved return", () => {
    const review = reviewOf(r => { r.context.returnAssumption = { kind: "stored-plan", annualPct: "0" }; });
    const built = buildRetirementConfirmation(review, stored); expect(built).toMatchObject({ ok: true });
    if (built.ok) expect(built.scenario.assumptions.returns).toEqual({ kind: "confirmed-return", annualPct: "0", basis: "stored-plan", sensitivity: null });
  });
  it("a missing contribution basis is never treated as zero; an explicit manual amount (even 0) is accepted", () => {
    const review = reviewOf(r => { r.context.contribution = { kind: "missing" }; });
    expect(buildRetirementConfirmation(review, stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(review, { ...stored, contribution: null })).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(review, { ...stored, contribution: { basis: "manual", amount: "0" } })).toMatchObject({ ok: true });
  });
  for (const amount of ["-1", "abc", "", "1,000", "1e3", "100.123", " 5", "5 ", ".5", "5.", "99999999999999999999999999999999"])
    it(`refuses the manual amount ${JSON.stringify(amount)}`, () => { expect(buildRetirementConfirmation(reviewOf(), { ...stored, contribution: { basis: "manual", amount } })).toMatchObject({ ok: false }); });
  it("a missing account value allows only the exact-deposits view", () => {
    const review = reviewOf(r => { r.context.currentValue = null; });
    expect(buildRetirementConfirmation(review, stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(review, { view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth" }, sensitivity: null, purchasingPower: { kind: "nominal" } })).toMatchObject({ ok: true });
  });
  it("the deposits-only view refuses invented balance, contribution, growth or inflation choices", () => {
    const base: RetirementChoices = { view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth" }, sensitivity: null, purchasingPower: { kind: "nominal" } };
    for (const bad of [{ ...base, contribution: { basis: "context" } }, { ...base, returns: { kind: "explicit", annualPct: "5" } }, { ...base, returns: { kind: "stored-plan" } },
      { ...base, purchasingPower: { kind: "today", inflationPct: "3" } }, { ...base, sensitivity: { lower: "1", base: "2", higher: "3" } }] as RetirementChoices[])
      expect(buildRetirementConfirmation(reviewOf(), bad)).toMatchObject({ ok: false });
  });
  it("sensitivity needs a confirmed return, ordered values and a base equal to the confirmed rate; equal values are allowed", () => {
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, returns: { kind: "no-growth" }, sensitivity: { lower: "1", base: "2", higher: "3" } })).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, sensitivity: { lower: "13", base: "12", higher: "20" } })).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, sensitivity: { lower: "5", base: "11", higher: "20" } })).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, sensitivity: { lower: "12", base: "12", higher: "12" } })).toMatchObject({ ok: true });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, sensitivity: { lower: "-100", base: "12", higher: "100" } })).toMatchObject({ ok: true });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, sensitivity: { lower: "-100.01", base: "12", higher: "100" } })).toMatchObject({ ok: false });
  });
  it("today's dollars needs a valid inflation; nominal is the initial default", () => {
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, purchasingPower: { kind: "today", inflationPct: "101" } })).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, purchasingPower: { kind: "today", inflationPct: "-1" } })).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, purchasingPower: { kind: "today", inflationPct: "0" } })).toMatchObject({ ok: true });
  });
  it("refuses forged or extra choice fields and a stale or invalid review instead of confirming", () => {
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, confirmed: true } as never)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, view: "other" } as never)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(r => { r.intent.startDate = "2026-10-18"; }), stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(r => { r.intent.retirementMonth = "2026-09"; }), stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(r => { r.context.account.type = "checking" as never; }), stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(null as never, stored)).toMatchObject({ ok: false });
  });
  it("failure reasons are plain sentences", () => {
    const reasons = [buildRetirementConfirmation(reviewOf(r => { r.context.returnAssumption = { kind: "missing" }; }), stored), buildRetirementConfirmation(reviewOf(), { ...stored, contribution: null })];
    for (const r of reasons) { if (r.ok) throw new Error("expected refusal"); expect(r.reason).toMatch(/\.$/); expect(r.reason).not.toMatch(/invalid-|undefined|basis|payload|validator/i); }
  });
});

describe("A5-3/A5-4 content: formatting anchors", () => {
  const e = (roundedDollars: number, roundingStepDollars: 10 | 100 | 1000, sign: RetirementEstimate["sign"], lessThanTen = false): RetirementEstimate => ({ roundedDollars, roundingStepDollars, sign, lessThanTen });
  it("formats rounded balances with grouping and a minus sign", () => {
    expect(retirementMoneyText(e(1100, 100, "positive"))).toBe("$1,100");
    expect(retirementMoneyText(e(1000000, 1000, "positive"))).toBe("$1,000,000");
    expect(retirementMoneyText(e(-950, 10, "negative"))).toBe("-$950");
    expect(retirementMoneyText(e(0, 10, "zero"))).toBe("$0");
    expect(retirementMoneyText(e(0, 10, "positive", true))).toBe("less than $10");
    expect(retirementMoneyText(e(0, 10, "negative", true))).toBe("less than $10");
    expect(retirementMoneyText(e(1e20, 1000, "positive"))).toBe("$100,000,000,000,000,000,000");
  });
  it("describes a difference in words with its direction", () => {
    expect(retirementDifferenceText(e(50, 10, "positive"))).toBe("$50 more");
    expect(retirementDifferenceText(e(-50, 10, "negative"))).toBe("$50 less");
    expect(retirementDifferenceText(e(0, 10, "positive", true))).toBe("less than $10 more");
    expect(retirementDifferenceText(e(0, 10, "negative", true))).toBe("less than $10 less");
    expect(retirementDifferenceText(e(0, 10, "zero"))).toBe("no change");
    expect(retirementDifferenceText(e(12000, 1000, "positive"))).toBe("$12,000 more");
  });
  it("formats exact deposits in cents and months in words", () => {
    expect(retirementExactMoneyText("600.00")).toBe("$600.00"); expect(retirementExactMoneyText("1200")).toBe("$1,200.00"); expect(retirementExactMoneyText("0.5")).toBe("$0.50");
    expect(retirementExactMoneyText("1234567.1")).toBe("$1,234,567.10"); expect(retirementExactMoneyText("0")).toBe("$0.00"); expect(retirementExactMoneyText("95073795017117205112252740402000.00")).toBe("$95,073,795,017,117,205,112,252,740,402,000.00");
    expect(retirementMonthText("2050-06")).toBe("June 2050"); expect(retirementMonthText("2026-01")).toBe("January 2026"); expect(retirementMonthText("2100-12")).toBe("December 2100");
    expect(retirementIllustrativeBalance("2050-06")).toBe("Illustrative balance at June 2050");
  });
  it("uses the plan's exact labels", () => {
    expect(RETIREMENT_COPY).toMatchObject({ noGrowth: "No investment growth", confirmedReturn: "Using your confirmed plan return", acrossTwo: "Across these two assumptions", usePlan: "Use my saved plan",
      depositsOnly: "Show extra deposits with no investment growth", chooseReturn: "Choose a return assumption", explore: "Explore other returns" });
  });
});

describe("A5-3/A5-4/A5-5 result content from real calculations", () => {
  const allText = (value: unknown): string => JSON.stringify(value);
  it("shows the two labelled assumptions, the date, the span and the exact deposits for the hand example", () => {
    const content = retirementResultContent(preview());
    expect(content.dateLine).toBe("Illustrative balance at November 2026");
    expect(content.rows.map(r => r.label)).toEqual(["No investment growth", "Using your confirmed plan return (12% a year)"]);
    expect(content.rows[0]).toMatchObject({ id: "no-growth", baseline: "$1,100", scenario: "$1,200", difference: "$50 more" });
    expect(content.rows[1]).toMatchObject({ id: "confirmed-return", baseline: "$1,100", scenario: "$1,200", difference: "$50 more" });
    expect(content.across).toContain("Across these two assumptions");
    expect(content.exactDeposits).toContain("$50.00");
    expect(content.exactDeposits).toMatch(/exact/i);
    expect(content.heading).toContain("Fictional IRA"); expect(content.heading).toContain("$50 each month");
    expect(content.fallback).toBeNull(); expect(content.canExplore).toBe(true);
  });
  it("shows the span as the two rounded balances with the extra, lowest first", () => {
    const content = retirementResultContent(preview(s => { s.context.currentValue = "25000"; s.assumptions.returns = { kind: "confirmed-return", annualPct: "8", basis: "explicit", sensitivity: null }; s.intent.retirementMonth = "2056-10"; }));
    const [none, plan] = content.rows; expect(content.across).toContain(none.scenario); expect(content.across).toContain(plan.scenario); expect(content.across!.indexOf(none.scenario)).toBeLessThan(content.across!.indexOf(plan.scenario));
  });
  it("a one-time deposit is described as once, with its exact total", () => {
    const content = retirementResultContent(preview(s => { s.intent.extra = { kind: "once", amount: "5000" }; }));
    expect(content.heading).toContain("$5,000 once"); expect(content.exactDeposits).toContain("$5,000.00");
  });
  it("without a confirmed return it shows only the no-growth illustration and says no growth forecast was made", () => {
    const content = retirementResultContent(preview(s => { s.assumptions.returns = { kind: "no-growth" }; }));
    expect(content.rows).toHaveLength(1); expect(content.rows[0].label).toBe("No investment growth"); expect(content.across).toBeNull(); expect(content.fallback).toBe("No investment growth forecast was made.");
    expect(allText(content)).not.toContain("Using your confirmed plan return");
  });
  it("a confirmed 0% return keeps its own label and never contradicts the no-growth label", () => {
    const content = retirementResultContent(preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "0", basis: "stored-plan", sensitivity: null }; s.context.returnAssumption = { kind: "stored-plan", annualPct: "0" }; }));
    expect(content.rows.map(r => r.label)).toEqual(["No investment growth", "Using your confirmed plan return (0% a year)"]);
    expect(content.rows[0].scenario).toBe(content.rows[1].scenario);
  });
  it("optional returns are tied to the rates the person entered and are not described as a range of outcomes", () => {
    const content = retirementResultContent(preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "-5", base: "12", higher: "20" } }; }));
    expect(content.sensitivity!.rows.map(r => r.label)).toEqual(["At -5% a year", "At 12% a year", "At 20% a year"]);
    expect(content.sensitivity!.heading).toMatch(/rates you (entered|chose)/i);
    expect(allText(content)).not.toMatch(FORBIDDEN_RETIREMENT_WORDING);
  });
  it("equal optional rates stay three labelled rows and do not invent a span", () => {
    const content = retirementResultContent(preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "12", base: "12", higher: "12" } }; }));
    expect(content.sensitivity!.rows).toHaveLength(3);
  });
  it("today's dollars are named, use one inflation for both figures, and keep the deposit total in plain cents", () => {
    const content = retirementResultContent(preview(s => { s.intent.retirementMonth = "2027-10"; s.assumptions.purchasingPower = { kind: "today", inflationPct: "3" }; }));
    expect(content.unitLine).toMatch(/today's dollars/i); expect(content.unitLine).toContain("3%"); expect(content.exactDeposits).toContain("$600.00");
    expect(retirementResultContent(preview()).unitLine).toMatch(/future dollars/i);
  });
  it("lists what is left out in the details", () => {
    const details = retirementResultContent(preview()).details.join(" ");
    expect(details).toMatch(/taxes/i); expect(details).toMatch(/fees/i); expect(details).toMatch(/employer match/i); expect(details).toMatch(/contribution limits/i); expect(details).toMatch(/nothing in your (accounts|data) was changed/i);
  });
  it("the caution says these are illustrations that can miss in either direction", () => {
    const caution = retirementResultContent(preview()).caution; expect(caution).toMatch(/illustrations/i); expect(caution).toMatch(/not predictions/i); expect(caution).toMatch(/lower than both or higher than both/i);
  });
  it("a tiny positive change shows as less than $10 with its direction, and exact zero as no change", () => {
    const tiny = retirementResultContent(preview(s => { s.context.currentValue = "0"; s.context.contribution = { kind: "saved", monthlyAmount: "0" }; s.assumptions.monthlyContribution = { basis: "context", amount: "0" }; s.intent.extra.amount = "0.04"; s.assumptions.returns = { kind: "no-growth" }; }));
    expect(tiny.rows[0].difference).toBe("less than $10 more");
    const zero = retirementResultContent(preview(s => { s.intent.extra.amount = "0"; }));
    expect(zero.rows[0].difference).toBe("no change");
  });
  it("a negative recorded worth shows with a minus sign", () => {
    const content = retirementResultContent(preview(s => { s.context.currentValue = "-1050"; s.assumptions.returns = { kind: "no-growth" }; }));
    expect(content.rows[0].baseline).toBe("-$950"); expect(content.rows[0].scenario).toBe("-$900");
  });
  it("never uses forbidden wording or jargon across a matrix of calculations", () => {
    const variants: ((s: ConfirmedRetirementScenario) => void)[] = [
      () => {}, s => { s.intent.extra.kind = "once"; }, s => { s.intent.retirementMonth = "2026-10"; }, s => { s.assumptions.returns = { kind: "no-growth" }; },
      s => { s.assumptions.purchasingPower = { kind: "today", inflationPct: "3" }; s.intent.retirementMonth = "2036-10"; },
      s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "5", basis: "explicit", sensitivity: { lower: "-100", base: "5", higher: "100" } }; },
      s => { s.context.currentValue = "-5"; }, s => { s.intent.extra.amount = "0"; },
    ];
    for (const patch of variants) {
      const text = allText(retirementResultContent(preview(patch)));
      expect(text).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); expect(text).not.toMatch(/nominal|annualized|compound|amortiz|basis point|projectAccount|undefined|NaN|\[object/i);
    }
  });
});

describe("A5-4/U4 deposits-only content", () => {
  it("shows the exact deposits and says no growth forecast was made, with no balance claim", () => {
    const content = retirementDepositsOnlyContent(depositsOnly());
    expect(content.exactDeposits).toContain("$50.00"); expect(content.fallback).toBe("No investment growth forecast was made.");
    expect(content.offers).toContain("Choose a return assumption");
    const text = JSON.stringify(content);
    expect(text).not.toMatch(/Illustrative balance|Using your confirmed plan return|Across these two/); expect(text).not.toMatch(FORBIDDEN_RETIREMENT_WORDING);
    expect(content.details.join(" ")).toMatch(/taxes/i);
  });
});

describe("A5-6/U2/U4 review card content", () => {
  it("a complete saved plan offers one primary action and describes each source", () => {
    const content = retirementReviewContent(reviewOf());
    expect(content.primary).toBe("Use my saved plan"); expect(content.needs).toEqual([]); expect(content.secondary).not.toContain("Use my saved plan");
    const facts = Object.fromEntries(content.facts.map(f => [f.label, f.value]));
    expect(facts["Account"]).toBe("Fictional IRA"); expect(facts["Retirement month"]).toContain("November 2026"); expect(facts["Return"]).toMatch(/12% a year.*saved in your plan/i); expect(facts["Adding now"]).toContain("$100"); expect(facts["Extra"]).toContain("$50 each month");
  });
  it("describes a saved zero return as saved, not missing", () => {
    const facts = Object.fromEntries(retirementReviewContent(reviewOf(r => { r.context.returnAssumption = { kind: "stored-plan", annualPct: "0" }; })).facts.map(f => [f.label, f.value]));
    expect(facts["Return"]).toMatch(/0% a year.*saved in your plan/i);
  });
  it("an untouched default is never described as something the person chose; no-growth deposits are offered promptly", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.returnAssumption = { kind: "application-default", annualPct: "7" }; }));
    const facts = Object.fromEntries(content.facts.map(f => [f.label, f.value]));
    expect(facts["Return"]).toMatch(/starting value/i); expect(facts["Return"]).toMatch(/not a (choice|return) you/i);
    expect(content.primary).toBe(RETIREMENT_COPY.noGrowthBalance); expect(content.secondary).toEqual([RETIREMENT_COPY.depositsOnly, RETIREMENT_COPY.chooseReturn]);
  });
  it("a missing return offers the same two next steps", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.returnAssumption = { kind: "missing" }; }));
    expect(content.primary).toBe(RETIREMENT_COPY.noGrowthBalance); expect(content.secondary).toEqual([RETIREMENT_COPY.depositsOnly, RETIREMENT_COPY.chooseReturn]);
  });
  it("a history average is labelled as an average of recent full months from the person's records", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.contribution = { kind: "history", monthlyAmount: "300", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 }; }));
    expect(Object.fromEntries(content.facts.map(f => [f.label, f.value]))["Adding now"]).toMatch(/average of your last 3 full months/i);
    expect(content.primary).toBe("Use my saved plan");
  });
  it("a missing contribution basis asks for the amount instead of assuming zero", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.contribution = { kind: "missing" }; }));
    expect(content.needs).toEqual(["contribution"]); expect(Object.fromEntries(content.facts.map(f => [f.label, f.value]))["Adding now"]).toMatch(/no recorded amount/i);
  });
  it("a missing account value leaves only the exact-deposits path", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.currentValue = null; }));
    expect(content.needs).toContain("worth"); expect(content.primary).toBe("Show extra deposits with no investment growth");
    expect(Object.fromEntries(content.facts.map(f => [f.label, f.value]))["Account value"]).toMatch(/no recorded value/i);
  });
  it("a recorded zero value is shown as $0, not as missing", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.currentValue = "0"; }));
    expect(content.needs).toEqual([]); expect(Object.fromEntries(content.facts.map(f => [f.label, f.value]))["Account value"]).toContain("$0");
  });
  it("offers today's dollars with the saved inflation as a candidate that still needs confirmation", () => {
    const facts = retirementReviewContent(reviewOf()).facts.map(f => `${f.label}: ${f.value}`).join("\n");
    expect(facts).toMatch(/Inflation: 3% a year \(saved\)/); const def = retirementReviewContent(reviewOf(r => { r.inflation = { kind: "application-default", pct: "3" }; })).facts.map(f => `${f.label}: ${f.value}`).join("\n");
    expect(def).toMatch(/starting value/i);
  });
  it("review text avoids forbidden wording and engineering words", () => {
    for (const patch of [(_r: RetirementReview) => {}, (r: RetirementReview) => { r.context.returnAssumption = { kind: "missing" }; }, (r: RetirementReview) => { r.context.contribution = { kind: "missing" }; r.context.currentValue = null; }]) {
      const { candidates: _prefill, notice, ...shown } = retirementReviewContent(reviewOf(patch)); const text = JSON.stringify({ ...shown, notice: notice?.text }); expect(text).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); expect(text).not.toMatch(/revision|payload|settingsRevision|application-default|stored-plan|undefined|null/);
    }
  });
});

describe("A5-6/P2 choice prompts", () => {
  it("asks only for what is missing, in the contract's order, and not again for an explicit amount or cadence", () => {
    const prompts = retirementChoicePrompts(draft({ missing: ["account", "start-date", "retirement-month"] }));
    expect(prompts.map(p => p.choice)).toEqual(["account", "start-date", "retirement-month"]);
    for (const p of prompts) { expect(p.prompt.length).toBeGreaterThan(8); expect(p.prompt).not.toMatch(/extra amount|each month or once/i); }
    expect(retirementChoicePrompts(draft({ extra: { kind: null, amount: null }, missing: ["account", "extra-amount", "cadence", "start-date", "retirement-month"] })).map(p => p.choice))
      .toEqual(["account", "extra-amount", "cadence", "start-date", "retirement-month"]);
  });
  it("offers the supported start as today and never a guessed retirement month", () => {
    const prompts = Object.fromEntries(retirementChoicePrompts(draft({ missing: ["account", "start-date", "retirement-month"] })).map(p => [p.choice, p.prompt]));
    expect(prompts["start-date"]).toMatch(/today/i); expect(prompts["retirement-month"]).toMatch(/month/i); expect(prompts["retirement-month"]).not.toMatch(/\b(20\d\d|19\d\d)\b/);
  });
});

describe("A5-6 flow copy: unsupported reasons, exploring, waiting and changed-data messages", () => {
  const codes = UNSUPPORTED_CODES;
  it("explains every unsupported reason in plain words, once each, without advice or forbidden wording", () => {
    const messages = codes.map(code => retirementUnsupportedMessage(code));
    expect(new Set(messages).size).toBe(codes.length);
    for (const [i, m] of messages.entries()) {
      expect(m.length, codes[i]).toBeGreaterThan(30); expect(m, codes[i]).toMatch(/[.?]$/); expect(m, codes[i]).not.toMatch(FORBIDDEN_RETIREMENT_WORDING);
      expect(m, codes[i]).not.toMatch(/reasonCode|unsupported|invalid|undefined|null|payload|nominal|[a-z]+-[a-z]+-[a-z]+/);
    }
  });
  it("never gives advice or a verdict", () => {
    for (const code of codes) expect(retirementUnsupportedMessage(code)).not.toMatch(/\byou should\b|\bI recommend\b|\bgood idea\b|\bwise\b|\byou can afford\b/i);
    expect(retirementUnsupportedMessage("advice")).toMatch(/can't (tell|say|decide)|cannot (tell|say|decide)/i);
  });
  it("offers a supported alternative where there is one", () => {
    for (const code of ["income", "multi-account", "employer-match", "tax", "fees", "contribution-limit", "cadence", "reduction", "condition", "account-not-found", "no-investment-account"] as const)
      expect(retirementUnsupportedMessage(code), code).toMatch(/I can (show|work out|estimate)/i);
  });
  it("names the bound when a rate, date or amount is outside what can be used", () => {
    expect(retirementUnsupportedMessage("rate-out-of-range")).toContain("-100%"); expect(retirementUnsupportedMessage("rate-out-of-range")).toContain("100%");
    expect(retirementUnsupportedMessage("date-range")).toContain("2100"); expect(retirementUnsupportedMessage("question-too-long")).toContain("512");
    expect(retirementUnsupportedMessage("amount-precision")).toMatch(/cents/i); expect(retirementUnsupportedMessage("past-date")).toMatch(/this month or later|in the future/i);
  });
  it("an unknown reason code gets a generic plain message instead of a crash", () => { expect(retirementUnsupportedMessage("mystery" as never)).toMatch(/can't (help|work)/i); });
  it("the explore form is tied to the person's own rates and says what the rates do and do not mean", () => {
    const copy = retirementExploreContent();
    expect(copy.heading).toBe("Explore other returns"); expect(copy.labels).toEqual(["Lower return (% a year)", "Your confirmed return (% a year)", "Higher return (% a year)"]);
    expect(copy.intro).toMatch(/rates you choose/i); expect(copy.intro).toMatch(/not what is likely/i); expect(copy.problem).toContain("-100"); expect(copy.problem).toMatch(/lowest first/i);
    expect(JSON.stringify(copy)).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); expect(copy.primary).toBe(RETIREMENT_PRIMARY_ACTION.explore);
  });
  it("waiting and changed-data messages are plain and say nothing was calculated or changed", () => {
    expect(retirementReadingMessage("Fictional IRA")).toBe("Reading Fictional IRA… Nothing has been calculated yet.");
    expect(retirementReadingMessage(null)).toBe("Reading your investment account… Nothing has been calculated yet.");
    expect(RETIREMENT_CHANGED_MESSAGE).toMatch(/no longer shown/i); expect(RETIREMENT_CHANGED_MESSAGE).toMatch(/ask again/i); expect(RETIREMENT_CHANGED_MESSAGE).not.toMatch(/revision|session|generation/i);
  });
  it("accessibility: every state announces a heading and keeps focus on the dialog, and results announce politely", () => {
    expect(Object.keys(RETIREMENT_ANNOUNCEMENTS).sort()).toEqual([...RETIREMENT_STAGES].sort());
    for (const [stage, a] of Object.entries(RETIREMENT_ANNOUNCEMENTS)) { if (a.heading !== null) expect(a.heading.length, stage).toBeGreaterThan(4); expect(["alert", "status", "none"]).toContain(a.live); }
    // The title of a state whose wording depends on the person's details comes from its content builder; the others are fixed here, so no state has two competing titles.
    expect(Object.entries(RETIREMENT_ANNOUNCEMENTS).filter(([, a]) => a.heading === null).map(([stage]) => stage).sort()).toEqual(["deposits-only", "result", "review"]);
    expect(RETIREMENT_ANNOUNCEMENTS.reading.live).toBe("status"); expect(RETIREMENT_ANNOUNCEMENTS.result.live).toBe("status"); expect(RETIREMENT_ANNOUNCEMENTS.error.live).toBe("alert"); expect(RETIREMENT_ANNOUNCEMENTS.stale.live).toBe("alert");
  });
});

describe("A5-1/U2/U4/U8 control labels the review card needs", () => {
  it("names every field and choice the card shows, in plain words", () => {
    expect(RETIREMENT_FIELDS).toEqual({
      manualAmount: "Amount you add now (dollars a month)", explicitReturn: "Return you choose (% a year)", purchasingPower: "Show amounts in",
      futureDollars: "Future dollars (not adjusted for inflation)", todaysDollars: "Today's dollars", inflation: "Inflation (% a year)", useReturn: "Use this return",
      retirementMonth: "Retirement month", account: "Investment account",
    });
    for (const label of Object.values(RETIREMENT_FIELDS)) { expect(label).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); expect(label).not.toMatch(/nominal|basis|payload/i); }
  });
  it("choosing your own return is a distinct, labelled primary action, not a hidden mode of another button", () => { expect(RETIREMENT_FIELDS.useReturn).not.toBe(RETIREMENT_PRIMARY_ACTION.review); });
});

describe("A5-1/P2/U2 the retirement month: from the question, or the plan's saved month as a candidate to confirm", () => {
  it("a review says where its month came from, and only the two sources exist", () => {
    for (const monthSource of ["question", "plan-candidate"] as const) expect(validateRetirementScreen({ stage: "review", review: reviewOf(r => { r.monthSource = monthSource; }) }, parse)).toEqual({ ok: true });
    expect(validateRetirementScreen({ stage: "review", review: reviewOf(r => { (r as { monthSource: string }).monthSource = "guess"; }) }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "review", review: reviewOf(r => { delete (r as { monthSource?: string }).monthSource; }) }, parse)).toMatchObject({ ok: false });
  });
  it("a plan candidate must be exactly the month saved in the plan, never a guess", () => {
    expect(validateRetirementScreen({ stage: "review", review: reviewOf(r => { r.monthSource = "plan-candidate"; r.context.retirementMonth = null; }) }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "review", review: reviewOf(r => { r.monthSource = "plan-candidate"; r.context.retirementMonth = "2030-01"; }) }, parse)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(r => { r.monthSource = "plan-candidate"; r.context.retirementMonth = "2030-01"; }), stored)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(r => { r.monthSource = "plan-candidate"; }), stored)).toMatchObject({ ok: true });
  });
  it("the card says when the month comes from the plan, so one click confirms it knowingly", () => {
    const fact = (r: RetirementReview) => Object.fromEntries(retirementReviewContent(r).facts.map(f => [f.label, f.value]));
    expect(fact(reviewOf(r => { r.monthSource = "plan-candidate"; }))["Retirement month"]).toMatch(/from your plan/i);
    expect(fact(reviewOf())["Retirement month"]).not.toMatch(/from your plan/i);
  });
  it("shows the plan's own month when the question asked for a different one, and nothing extra when they agree", () => {
    const fact = (r: RetirementReview) => Object.fromEntries(retirementReviewContent(r).facts.map(f => [f.label, f.value]));
    expect(fact(reviewOf(r => { r.context.retirementMonth = "2030-01"; }))["Month in your plan"]).toBe("January 2030");
    expect(fact(reviewOf())["Month in your plan"]).toBeUndefined();
    expect(fact(reviewOf(r => { r.context.retirementMonth = null; }))["Month in your plan"]).toBeUndefined();
  });
});

describe("A5-1 changing the month on the card", () => {
  it("names the control that lets the person replace the plan's month", () => { expect(RETIREMENT_COPY.pickAnotherMonth).toBe("Pick another month"); expect(RETIREMENT_COPY.pickAnotherMonth).not.toBe(RETIREMENT_PRIMARY_ACTION.review); });
});

// ---- Review defects F5, F6, F8 (independent review of 18 October 2026) ------------------------------------------------------------------------------------
describe("F5 the consent builder refuses invalid nested choices instead of repairing them", () => {
  const bad: [string, unknown][] = [
    ["an invented contribution basis", { ...stored, contribution: { basis: "invented", amount: "999" } }],
    ["a context contribution carrying an amount", { ...stored, contribution: { basis: "context", amount: "5" } }],
    ["a manual contribution with no amount", { ...stored, contribution: { basis: "manual" } }],
    ["a manual contribution with an extra key", { ...stored, contribution: { basis: "manual", amount: "5", note: 1 } }],
    ["a numeric manual amount", { ...stored, contribution: { basis: "manual", amount: 5 } }],
    ["an array contribution", { ...stored, contribution: [] }],
    ["an invented purchasing-power kind", { ...stored, purchasingPower: { kind: "invented" } }],
    ["nominal dollars carrying an inflation", { ...stored, purchasingPower: { kind: "nominal", inflationPct: "3" } }],
    ["today's dollars with no inflation", { ...stored, purchasingPower: { kind: "today" } }],
    ["a numeric inflation", { ...stored, purchasingPower: { kind: "today", inflationPct: 3 } }],
    ["null purchasing power", { ...stored, purchasingPower: null }],
    ["null returns", { ...stored, returns: null }],
    ["an unknown returns kind", { ...stored, returns: { kind: "invented" } }],
    ["a stored-plan return carrying a rate", { ...stored, returns: { kind: "stored-plan", annualPct: "9" } }],
    ["a no-growth return carrying a rate", { ...stored, returns: { kind: "no-growth", annualPct: "5" } }],
    ["an explicit return with no rate", { ...stored, returns: { kind: "explicit" } }],
    ["an explicit return with a numeric rate", { ...stored, returns: { kind: "explicit", annualPct: 5 } }],
    ["an explicit return with an extra key", { ...stored, returns: { kind: "explicit", annualPct: "5", basis: "stored-plan" } }],
    ["a partial sensitivity", { ...stored, sensitivity: { lower: "1", base: "12" } }],
    ["a sensitivity with an extra key", { ...stored, sensitivity: { lower: "1", base: "12", higher: "20", mid: "5" } }],
    ["a numeric sensitivity", { ...stored, sensitivity: { lower: 1, base: 12, higher: 20 } }],
    ["an undefined sensitivity", { ...stored, sensitivity: undefined }],
    ["an array sensitivity", { ...stored, sensitivity: [] }],
    ["missing choices", null], ["array choices", []], ["string choices", "stored"],
  ];
  for (const [label, choices] of bad) it(`refuses ${label} without throwing`, () => {
    let out: ReturnType<typeof buildRetirementConfirmation> | undefined;
    expect(() => { out = buildRetirementConfirmation(reviewOf(), choices as never); }).not.toThrow();
    expect(out).toMatchObject({ ok: false });
    expect((out as { reason: string }).reason).toMatch(/\.$/);
  });
  it("refuses hidden and symbol fields on every nested choice object", () => {
    const withHidden = (key: "contribution" | "returns" | "purchasingPower", how: "hidden" | "symbol"): RetirementChoices => {
      const choices = structuredClone({ ...stored, contribution: { basis: "manual", amount: "5" } }) as unknown as Record<string, Record<string, unknown>>;
      if (how === "hidden") Object.defineProperty(choices[key], "x", { value: 1 }); else choices[key][Symbol("x") as unknown as string] = 1;
      return choices as unknown as RetirementChoices;
    };
    for (const key of ["contribution", "returns", "purchasingPower"] as const) for (const how of ["hidden", "symbol"] as const) expect(buildRetirementConfirmation(reviewOf(), withHidden(key, how)), `${key} ${how}`).toMatchObject({ ok: false });
    const sens = structuredClone({ ...stored, sensitivity: { lower: "5", base: "12", higher: "20" } }) as unknown as { sensitivity: Record<string, unknown> };
    Object.defineProperty(sens.sensitivity, "x", { value: 1 }); expect(buildRetirementConfirmation(reviewOf(), sens as never)).toMatchObject({ ok: false });
  });
  it("an invalid choice never yields a scenario even when the view is deposits-only", () => {
    expect(buildRetirementConfirmation(reviewOf(), { view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth", annualPct: "5" }, sensitivity: null, purchasingPower: { kind: "nominal" } } as never)).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(), { view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth" }, sensitivity: null, purchasingPower: { kind: "nominal", extra: 1 } } as never)).toMatchObject({ ok: false });
  });
  it("a malformed review (null parts) is refused, not thrown", () => {
    for (const review of [null, {}, { ...reviewOf(), context: null }, { ...reviewOf(), context: { ...reviewOf().context, source: null } }, { ...reviewOf(), context: { ...reviewOf().context, account: null } }, { ...reviewOf(), intent: null }, { ...reviewOf(), questionAssumptions: null }])
      expect(() => buildRetirementConfirmation(review as never, stored)).not.toThrow();
    expect(buildRetirementConfirmation({ ...reviewOf(), context: { ...reviewOf().context, account: null } } as never, stored)).toMatchObject({ ok: false });
  });
});

describe("F6 the trusted-result boundary: a displayed result must equal what the calculator makes from its own confirmed terms", () => {
  const ok = (stage: "result" | "deposits-only" | "explore", calculation: unknown) => validateRetirementScreen({ stage, calculation }, parse);
  it("accepts untouched calculations (including sensitivity and today's dollars)", () => {
    expect(ok("result", preview())).toEqual({ ok: true });
    expect(ok("explore", preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "-5", base: "12", higher: "20" } }; }))).toEqual({ ok: true });
    expect(ok("result", preview(s => { s.assumptions.purchasingPower = { kind: "today", inflationPct: "3" }; s.intent.retirementMonth = "2027-10"; }))).toEqual({ ok: true });
    expect(ok("deposits-only", depositsOnly())).toEqual({ ok: true });
  });
  it("rejects the reviewer's reproduction: extra deposits changed to 999999.00 with a matching display difference", () => {
    const calc = preview() as unknown as { extraDeposits: string; noGrowth: { display: { difference: { roundedDollars: number } } } };
    calc.extraDeposits = "999999.00"; calc.noGrowth.display.difference.roundedDollars = 999000;
    expect(ok("result", calc)).toMatchObject({ ok: false });
  });
  for (const [label, edit] of [
    ["extra deposits", (c: Record<string, any>) => { c.extraDeposits = "51.00"; }],
    ["a displayed baseline", (c: Record<string, any>) => { c.noGrowth.display.baseline.roundedDollars += 100; }],
    ["a displayed scenario", (c: Record<string, any>) => { c.confirmedReturn.display.scenario.roundedDollars += 100; }],
    ["a displayed difference sign", (c: Record<string, any>) => { c.noGrowth.display.difference.sign = "negative"; }],
    ["a rounding step", (c: Record<string, any>) => { c.noGrowth.display.baseline.roundingStepDollars = 1000; }],
    ["a projection point", (c: Record<string, any>) => { c.noGrowth.baseline.points[1].balance += 1; }],
    ["the annual return label", (c: Record<string, any>) => { c.confirmedReturn.annualReturnPct = "6"; }],
    ["the series unit", (c: Record<string, any>) => { c.seriesUnit = "today-dollars"; }],
    ["the month count", (c: Record<string, any>) => { c.months += 1; }],
    ["an extra top-level field", (c: Record<string, any>) => { c.note = "x"; }],
    ["a hidden top-level field", (c: Record<string, any>) => { Object.defineProperty(c, "hidden", { value: 1 }); }],
    ["a hidden nested display field", (c: Record<string, any>) => { Object.defineProperty(c.noGrowth.display.baseline, "hidden", { value: 1 }); }],
    ["a dropped confirmed-return illustration", (c: Record<string, any>) => { c.confirmedReturn = null; }],
  ] as [string, (c: Record<string, any>) => void][]) it(`rejects an altered ${label}`, () => {
    const calc = preview() as unknown as Record<string, any>; edit(calc); expect(ok("result", calc)).toMatchObject({ ok: false });
  });
  it("rejects altered optional-return rows and altered exact deposits-only totals", () => {
    const withRates = preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "-5", base: "12", higher: "20" } }; }) as unknown as Record<string, any>;
    withRates.sensitivity[0].display.scenario.roundedDollars += 10; expect(ok("explore", withRates)).toMatchObject({ ok: false });
    const deposits = depositsOnly() as unknown as Record<string, any>; deposits.extraDeposits = "49.99"; expect(ok("deposits-only", deposits)).toMatchObject({ ok: false });
  });
  it("rejects a result whose embedded scenario was edited after it was calculated", () => {
    const calc = preview() as unknown as Record<string, any>; calc.scenario.context.currentValue = "5000"; expect(ok("result", calc)).toMatchObject({ ok: false });
    const intent = preview() as unknown as Record<string, any>; intent.scenario.intent.extra.amount = "75"; expect(ok("result", intent)).toMatchObject({ ok: false });
  });
  it("fails gracefully, never by throwing, on malformed results", () => {
    const cases: unknown[] = [null, "x", [], {}, { kind: "preview" }, { kind: "preview", scenario: null }, { kind: "preview", scenario: {} }, { kind: "preview", scenario: { context: null } },
      { kind: "preview", scenario: { context: {} } }, { kind: "preview", scenario: { context: { source: null } } }];
    const noSource = preview() as unknown as Record<string, any>; delete noSource.scenario.context.source; cases.push(noSource);
    const noAccount = preview() as unknown as Record<string, any>; noAccount.scenario.context.account = null; cases.push(noAccount);
    const noIntent = preview() as unknown as Record<string, any>; noIntent.scenario.intent = undefined; cases.push(noIntent);
    for (const calculation of cases) for (const stage of ["result", "explore", "deposits-only"] as const) {
      let out: unknown; expect(() => { out = ok(stage, calculation); }).not.toThrow(); expect(out).toMatchObject({ ok: false });
    }
  });
  it("rejects a refusal with extra fields, a blank message or an unknown code", () => {
    const refusal = { kind: "refused", code: "unsupported-number", message: "Choose usable assumptions." };
    expect(validateRetirementScreen({ stage: "blocked", calculation: refusal }, parse)).toEqual({ ok: true });
    for (const bad of [{ ...refusal, extra: 1 }, { ...refusal, message: " " }, { ...refusal, code: "other" }, { ...refusal, scenario: {} }, null, []])
      expect(validateRetirementScreen({ stage: "blocked", calculation: bad }, parse)).toMatchObject({ ok: false });
  });
  it("still checks the live roster and date for the account the result is about", () => {
    expect(validateRetirementScreen({ stage: "result", calculation: preview() }, { ...parse, today: "2026-10-18" })).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "result", calculation: preview() }, { ...parse, investmentAccounts: [{ id: 7, name: "Renamed" }] })).toMatchObject({ ok: false });
  });
});

describe("F8 partial choices, the plan's month candidate, and the question's own assumptions reach the review", () => {
  const live = () => ({ context: examples()[0].input.context, inflation: { kind: "stored", pct: "3" } as const });
  const draftFor = (over: Partial<RetirementDraft> = {}): RetirementDraft => draft({ accountId: 7, missing: ["start-date", "retirement-month"], ...over });
  const complete = (over: Partial<Extract<RetirementChoicesEvent, { step: "complete" }>> = {}): Extract<RetirementChoicesEvent, { step: "complete" }> =>
    ({ step: "complete", intent: examples()[0].input.intent, monthSource: "question", questionAssumptions: { annualReturnPct: null, inflationPct: null }, ...over });

  it("names the two events: a partial account step and a complete step", () => {
    expect(validateRetirementChoicesEvent({ step: "account", draft: draftFor() }, parse)).toEqual({ ok: true });
    expect(validateRetirementChoicesEvent(complete(), parse)).toEqual({ ok: true });
  });
  it("an account step needs a chosen, current investment account and a consistent partial draft", () => {
    for (const bad of [draftFor({ accountId: null, missing: ["account", "start-date", "retirement-month"] }), draftFor({ accountId: 99 }), draftFor({ missing: [] }), draftFor({ sourceText: " " })])
      expect(validateRetirementChoicesEvent({ step: "account", draft: bad }, parse)).toMatchObject({ ok: false });
  });
  it("an account step may still miss the amount, the cadence and the month (they are chosen after the read)", () => {
    expect(validateRetirementChoicesEvent({ step: "account", draft: draftFor({ extra: { kind: null, amount: null }, missing: ["extra-amount", "cadence", "start-date", "retirement-month"] }) }, parse)).toEqual({ ok: true });
  });
  it("a complete step needs a valid intent, a known month source and explicit question assumptions", () => {
    const e = complete() as unknown as Record<string, any>;
    for (const bad of [{ ...e, monthSource: "guess" }, { ...e, monthSource: undefined }, { ...e, questionAssumptions: undefined }, { ...e, questionAssumptions: { annualReturnPct: "5" } },
      { ...e, questionAssumptions: { annualReturnPct: "101", inflationPct: null } }, { ...e, questionAssumptions: { annualReturnPct: null, inflationPct: "-1" } },
      { ...e, questionAssumptions: { annualReturnPct: 5, inflationPct: null } }, { ...e, extra: 1 }, { ...e, intent: { ...e.intent, accountId: 99 } }, { ...e, intent: { ...e.intent, startDate: "2026-10-18" } }, null, [], "complete"])
      expect(validateRetirementChoicesEvent(bad, parse)).toMatchObject({ ok: false });
    expect(validateRetirementChoicesEvent({ step: "other", draft: draftFor() }, parse)).toMatchObject({ ok: false });
    expect(validateRetirementChoicesEvent(complete({ questionAssumptions: { annualReturnPct: "-100", inflationPct: "0" } }), parse)).toEqual({ ok: true });
  });
  it("builds a review from a complete event and the read context, carrying the question's own assumptions", () => {
    const built = buildRetirementReview(complete({ questionAssumptions: { annualReturnPct: "5", inflationPct: "2" } }), live(), parse);
    expect(built).toMatchObject({ ok: true });
    if (built.ok) { expect(built.review.questionAssumptions).toEqual({ annualReturnPct: "5", inflationPct: "2" }); expect(built.review.monthSource).toBe("question"); expect(validateRetirementScreen({ stage: "review", review: built.review }, parse)).toEqual({ ok: true }); }
  });
  it("never shares objects with the event or the read", () => {
    const read = live(), event = complete(); const built = buildRetirementReview(event, read, parse); if (!built.ok) throw new Error(built.reason);
    built.review.intent.extra.amount = "999"; built.review.context.account.name = "X"; expect(event.intent.extra.amount).toBe("50"); expect(read.context.account.name).toBe("Fictional IRA");
  });
  it("refuses an event for a different account than the one read, or a read from another day", () => {
    expect(buildRetirementReview(complete({ intent: { ...examples()[0].input.intent, accountId: 8 } }), live(), { ...parse, investmentAccounts: [...parse.investmentAccounts, { id: 8, name: "Other" }] })).toMatchObject({ ok: false });
    expect(buildRetirementReview(complete(), live(), { ...parse, today: "2026-10-18" })).toMatchObject({ ok: false });
    expect(buildRetirementReview(complete(), { context: null as never, inflation: { kind: "missing" } }, parse)).toMatchObject({ ok: false });
  });
  it("a plan-candidate month must equal the plan's saved month; a typed or question month may differ from it", () => {
    const planMonth = examples()[0].input.intent.retirementMonth;
    const withPlan = (month: string | null) => ({ ...live(), context: { ...live().context, retirementMonth: month } });
    expect(buildRetirementReview(complete({ monthSource: "plan-candidate" }), withPlan(planMonth), parse)).toMatchObject({ ok: true });
    expect(buildRetirementReview(complete({ monthSource: "plan-candidate" }), withPlan("2035-01"), parse)).toMatchObject({ ok: false });
    expect(buildRetirementReview(complete({ monthSource: "plan-candidate" }), withPlan(null), parse)).toMatchObject({ ok: false });
    expect(buildRetirementReview(complete({ monthSource: "typed" }), withPlan("2035-01"), parse)).toMatchObject({ ok: true });
    expect(buildRetirementReview(complete({ monthSource: "question" }), withPlan(null), parse)).toMatchObject({ ok: true });
  });
  it("a draft with a month in the question becomes a question-month event; a missing month takes the typed or candidate month; nothing is guessed", () => {
    const base = draftFor({ retirementMonth: "2026-11", startDate: parse.today, missing: [], assumptions: { annualReturnPct: "5", inflationPct: null } });
    const fromQuestion = retirementCompleteEvent(base, parse, null); expect(fromQuestion).toMatchObject({ ok: true });
    if (fromQuestion.ok) { expect(fromQuestion.event.monthSource).toBe("question"); expect(fromQuestion.event.intent.retirementMonth).toBe("2026-11"); expect(fromQuestion.event.questionAssumptions).toEqual({ annualReturnPct: "5", inflationPct: null }); }
    const noMonth = draftFor({ missing: ["retirement-month"], startDate: parse.today });
    expect(retirementCompleteEvent(noMonth, parse, null)).toMatchObject({ ok: false });
    expect(retirementCompleteEvent(noMonth, parse, { value: "2030-05", source: "plan-candidate" })).toMatchObject({ ok: true, event: { monthSource: "plan-candidate" } });
    expect(retirementCompleteEvent(noMonth, parse, { value: "2030-05", source: "typed" })).toMatchObject({ ok: true, event: { monthSource: "typed" } });
    expect(retirementCompleteEvent(noMonth, parse, { value: "2030-05", source: "question" as never })).toMatchObject({ ok: false });
    expect(retirementCompleteEvent(base, parse, { value: "2030-05", source: "typed" })).toMatchObject({ ok: false }); // the question's month is not silently replaced
    expect(retirementCompleteEvent(noMonth, parse, { value: "2026-09", source: "typed" })).toMatchObject({ ok: false });
  });
  it("an unstated start is today; a later start the question stated is never silently replaced by today", () => {
    const stated = draftFor({ missing: ["start-date", "retirement-month"], startDate: null, hints: [] });
    // The question named a later start (null start, listed as missing). The card says it starts today; continuing requires the person to acknowledge that.
    expect(retirementCompleteEvent(stated, parse, { value: "2030-05", source: "typed" })).toMatchObject({ ok: false, reason: "This starts today. Starting on a later date isn't supported yet." });
    const acknowledged = retirementCompleteEvent(stated, parse, { value: "2030-05", source: "typed" }, true); expect(acknowledged).toMatchObject({ ok: true });
    if (acknowledged.ok) expect(acknowledged.event.intent.startDate).toBe(parse.today);
    const unstated = draftFor({ missing: ["retirement-month"], startDate: parse.today });
    const out = retirementCompleteEvent(unstated, parse, { value: "2030-05", source: "typed" }); expect(out).toMatchObject({ ok: true });
    if (out.ok) expect(out.event.intent.startDate).toBe(parse.today);
    expect(retirementCompleteEvent(unstated, parse, { value: "2030-05", source: "typed" }, true)).toMatchObject({ ok: true }); // acknowledging when nothing was stated changes nothing
  });
  it("a missing account, amount or cadence is refused", () => {
    expect(retirementCompleteEvent(draftFor({ accountId: null, missing: ["account", "start-date", "retirement-month"] }), parse, { value: "2030-05", source: "typed" }, true)).toMatchObject({ ok: false });
    expect(retirementCompleteEvent(draftFor({ extra: { kind: null, amount: "50" }, missing: ["cadence", "start-date", "retirement-month"] }), parse, { value: "2030-05", source: "typed" }, true)).toMatchObject({ ok: false });
    expect(retirementCompleteEvent(draftFor({ extra: { kind: "monthly", amount: null }, missing: ["extra-amount", "start-date", "retirement-month"] }), parse, { value: "2030-05", source: "typed" }, true)).toMatchObject({ ok: false });
    // The same drafts with today's start made explicit are refused for the right reason, not for an inconsistent draft.
    for (const bad of [draftFor({ accountId: null, missing: ["account", "retirement-month"], startDate: parse.today }), draftFor({ extra: { kind: null, amount: "50" }, missing: ["cadence", "retirement-month"], startDate: parse.today }),
      draftFor({ extra: { kind: "monthly", amount: null }, missing: ["extra-amount", "retirement-month"], startDate: parse.today })]) {
      expect(validateRetirementDraft(bad, parse)).toEqual({ ok: true });
      expect(retirementCompleteEvent(bad, parse, { value: "2030-05", source: "typed" })).toMatchObject({ ok: false, reason: "Choose the account, the amount and whether it is monthly or once." });
    }
  });
  it("the choices screen carries the plan's month as an optional candidate that must be current and in range", () => {
    const base = screens().choices as Extract<RetirementScreen, { stage: "choices" }>;
    const withDraft = { ...base, draft: draftFor() };
    for (const monthCandidate of [null, "2030-05", parse.today.slice(0, 7)]) expect(validateRetirementScreen({ ...withDraft, monthCandidate }, parse)).toEqual({ ok: true });
    for (const monthCandidate of ["2026-09", "2200-01", "June 2030", 5, undefined, "2030-13"]) expect(validateRetirementScreen({ ...withDraft, monthCandidate }, parse), String(monthCandidate)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ ...base, draft: draftFor({ retirementMonth: "2026-11", missing: ["start-date"] }), monthCandidate: "2030-05" }, parse)).toMatchObject({ ok: false });
  });
  it("the choices screen can say the plan's saved month is beyond what can be calculated, and never offers it as a candidate", () => {
    const base = screens().choices as Extract<RetirementScreen, { stage: "choices" }>;
    const withDraft = { ...base, draft: draftFor() };
    for (const savedMonthLimit of [null, "2101-01", "2200-12"]) expect(validateRetirementScreen({ ...withDraft, monthCandidate: null, savedMonthLimit }, parse), String(savedMonthLimit)).toEqual({ ok: true });
    for (const savedMonthLimit of ["2030-05", "2026-09", parse.today.slice(0, 7), "2101-13", "June 2101", "2101-01-01", 5, undefined]) {
      expect(validateRetirementScreen({ ...withDraft, monthCandidate: null, savedMonthLimit }, parse), String(savedMonthLimit)).toMatchObject({ ok: false });
    }
    expect(validateRetirementScreen({ ...withDraft, monthCandidate: "2030-05", savedMonthLimit: "2101-01" }, parse)).toMatchObject({ ok: false });
  });
  it("refuses to explain a saved month when the question already gave one", () => {
    const base = screens().choices as Extract<RetirementScreen, { stage: "choices" }>;
    const given = { ...base, draft: draftFor({ retirementMonth: "2030-05", missing: ["start-date"] }), monthCandidate: null };
    expect(validateRetirementScreen({ ...given, savedMonthLimit: null }, parse)).toEqual({ ok: true });
    expect(validateRetirementScreen({ ...given, savedMonthLimit: "2101-01" }, parse)).toMatchObject({ ok: false });
  });
  it("tells a saved month that is beyond the limit from one that is usable, passed or malformed", () => {
    for (const month of ["2101-01", "2200-12", "9999-12"]) expect(retirementSavedMonthBeyondLimit(month, parse.today), month).toBe(true);
    for (const month of ["2030-05", parse.today.slice(0, 7), "2026-09", "2100-12", null, undefined, 5, "2101-13", "June 2101", "2101-01-01", ""]) expect(retirementSavedMonthBeyondLimit(month, parse.today), String(month)).toBe(false);
  });
  it("a month long past is not beyond the limit, and the 1,200-month bound applies when the date is early enough for it to bind", () => {
    expect(retirementSavedMonthBeyondLimit("1800-01", parse.today)).toBe(false);
    expect(retirementSavedMonthBeyondLimit("1899-12", "1950-06-15")).toBe(false);
    expect(retirementSavedMonthBeyondLimit("2050-06", "1950-06-15")).toBe(false);
    expect(retirementSavedMonthBeyondLimit("2050-07", "1950-06-15")).toBe(true);
    expect(retirementSavedMonthBeyondLimit("2101-01", "bad date")).toBe(false);
  });
  it("explains the limit in plain words, names the saved month and asks for a supported one", () => {
    const text = retirementSavedMonthLimitMessage("2101-01");
    expect(text).toContain("January 2101"); expect(text).toContain("December 2100"); expect(text).toMatch(/pick|choose/i);
  });
  it("the review shows a saved month beyond the limit as saved evidence, and says it cannot be calculated", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.retirementMonth = "2101-01"; }));
    const row = content.facts.find(f => f.label === "Month in your plan");
    expect(row?.value).toContain("January 2101"); expect(row?.value).toMatch(/later than/i);
  });
  it("a review validates the question assumptions and keeps them out of consent", () => {
    const withQ = (annualReturnPct: string | null, inflationPct: string | null) => reviewOf(r => { r.questionAssumptions = { annualReturnPct, inflationPct }; });
    expect(validateRetirementScreen({ stage: "review", review: withQ("5", "2") }, parse)).toEqual({ ok: true });
    for (const bad of [withQ("101", null), withQ(null, "-1"), withQ("5.5.5", null), reviewOf(r => { delete (r as { questionAssumptions?: unknown }).questionAssumptions; }), reviewOf(r => { (r as { questionAssumptions: unknown }).questionAssumptions = { annualReturnPct: "5" }; })])
      expect(validateRetirementScreen({ stage: "review", review: bad }, parse)).toMatchObject({ ok: false });
    // The question's return is only a candidate: the saved plan is still what "stored" means and nothing is confirmed until the builder runs.
    const built = buildRetirementConfirmation(withQ("5", null), stored); if (!built.ok) throw new Error(built.reason);
    expect(built.scenario.assumptions.returns).toMatchObject({ basis: "stored-plan", annualPct: "12" });
  });
  it("shows a stated return beside the saved one, offers it first, and never auto-confirms it", () => {
    const content = retirementReviewContent(reviewOf(r => { r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; }));
    const facts = Object.fromEntries(content.facts.map(f => [f.label, f.value]));
    expect(facts["Return"]).toMatch(/12% a year.*saved in your plan/i); expect(facts["Return in your question"]).toMatch(/5% a year/);
    expect(content.candidates).toEqual({ returnPct: "5", inflationPct: "3" }); expect(content.primary).toBe("Use 5% a year, as you asked");
    expect(content.secondary).toContain("Use my saved plan");
  });
  it("a stated return with no saved plan return is still only a candidate to confirm", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.returnAssumption = { kind: "application-default", annualPct: "7" }; r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; }));
    expect(content.primary).toBe("Use 5% a year, as you asked"); expect(content.candidates.returnPct).toBe("5"); expect(content.secondary).not.toContain("Use my saved plan");
    expect(retirementReviewContent(reviewOf(r => { r.context.returnAssumption = { kind: "application-default", annualPct: "7" }; })).candidates.returnPct).toBeNull();
  });
  it("a stated return needs a recorded value; without one only the exact deposits path remains", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.currentValue = null; r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; }));
    expect(content.primary).toBe("Show extra deposits with no investment growth"); expect(content.needs).toContain("worth");
  });
  it("a stated inflation replaces the saved one as the prefilled candidate and the saved one is still shown", () => {
    const content = retirementReviewContent(reviewOf(r => { r.questionAssumptions = { annualReturnPct: null, inflationPct: "2" }; }));
    const facts = Object.fromEntries(content.facts.map(f => [f.label, f.value]));
    expect(content.candidates.inflationPct).toBe("2"); expect(facts["Inflation in your question"]).toMatch(/2% a year/); expect(facts["Inflation"]).toMatch(/3% a year.*saved/i);
  });
  it("the month source decides the wording, including a typed month", () => {
    const fact = (monthSource: RetirementReview["monthSource"]) => Object.fromEntries(retirementReviewContent(reviewOf(r => { r.monthSource = monthSource; })).facts.map(f => [f.label, f.value]))["Retirement month"];
    expect(fact("question")).not.toMatch(/from your plan|you picked/i); expect(fact("typed")).toMatch(/you picked/i);
    expect(validateRetirementScreen({ stage: "review", review: reviewOf(r => { r.monthSource = "typed"; }) }, parse)).toEqual({ ok: true });
  });
  it("the review text adds no forbidden wording or engineering words", () => {
    const { candidates: _prefill, notice, ...shown } = retirementReviewContent(reviewOf(r => { r.questionAssumptions = { annualReturnPct: "5", inflationPct: "2" }; r.monthSource = "typed"; })); const text = JSON.stringify({ ...shown, notice: notice?.text });
    expect(text).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); expect(text).not.toMatch(/revision|payload|application-default|stored-plan|undefined|null/);
  });
});

describe("F7 follow-up: exploring other returns is offered only when it can work", () => {
  it("is offered with a confirmed return and no optional returns yet", () => { expect(retirementResultContent(preview()).canExplore).toBe(true); });
  it("is not offered after a no-growth confirmation, because other returns need a confirmed return first", () => {
    const content = retirementResultContent(preview(s => { s.assumptions.returns = { kind: "no-growth" }; }));
    expect(content.canExplore).toBe(false);
    expect(buildRetirementConfirmation(reviewOf(), { ...stored, returns: { kind: "no-growth" }, sensitivity: { lower: "1", base: "2", higher: "3" } })).toMatchObject({ ok: false });
  });
  it("is not offered again once the optional returns are already shown", () => {
    expect(retirementResultContent(preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "-5", base: "12", higher: "20" } }; })).canExplore).toBe(false);
  });
});

describe("F7 follow-up: a typed return or inflation that cannot be used gets a specific, plain reason", () => {
  const reason = (choices: RetirementChoices) => { const out = buildRetirementConfirmation(reviewOf(), choices); if (out.ok) throw new Error("expected a refusal"); return out.reason; };
  for (const annualPct of ["", "abc", "150", "-101", "5%", " 5", "1e2", "5.", ".5"])
    it(`explains a typed return of ${JSON.stringify(annualPct)}`, () => { expect(reason({ ...stored, returns: { kind: "explicit", annualPct } })).toBe("Enter a yearly return from -100% to 100%."); });
  for (const inflationPct of ["", "abc", "101", "-1", "3%"])
    it(`explains a typed inflation of ${JSON.stringify(inflationPct)}`, () => { expect(reason({ ...stored, purchasingPower: { kind: "today", inflationPct } })).toBe("Enter yearly inflation from 0% to 100%."); });
  it("still accepts the bounds and ordinary decimals", () => {
    for (const annualPct of ["-100", "100", "0", "6.5", "-0.5"]) expect(buildRetirementConfirmation(reviewOf(), { ...stored, returns: { kind: "explicit", annualPct } })).toMatchObject({ ok: true });
    for (const inflationPct of ["0", "100", "2.5"]) expect(buildRetirementConfirmation(reviewOf(), { ...stored, purchasingPower: { kind: "today", inflationPct } })).toMatchObject({ ok: true });
  });
  it("names the sensitivity problem plainly too", () => {
    expect(reason({ ...stored, sensitivity: { lower: "13", base: "12", higher: "20" } })).toBe("Enter returns from -100 to 100, lowest first.");
    expect(reason({ ...stored, sensitivity: { lower: "5", base: "12", higher: "abc" } })).toBe("Enter returns from -100 to 100, lowest first.");
    expect(reason({ ...stored, sensitivity: { lower: "5", base: "11", higher: "20" } })).toBe("Enter returns from -100 to 100, lowest first.");
  });
});

// ---- Second independent review (19 October 2026): four screen and flow issues, and the class each belongs to ---------------------------------------------------
describe("R2-1 no usable return but a valid basis: the no-growth BALANCE is offered, deposits-only is the fallback (Requirements-Checklist U4)", () => {
  const withReturn = (kind: "application-default" | "missing") => (r: RetirementReview) => { r.context.returnAssumption = kind === "missing" ? { kind: "missing" } : { kind: "application-default", annualPct: "7" }; };
  for (const kind of ["application-default", "missing"] as const) {
    it(`with a ${kind} return and a recorded value the primary action shows the balance with no investment growth`, () => {
      const content = retirementReviewContent(reviewOf(withReturn(kind)));
      expect(content.primary).toBe(RETIREMENT_COPY.noGrowthBalance); expect(RETIREMENT_COPY.noGrowthBalance).toBe("Show the balance with no investment growth");
      expect(content.secondary).toEqual([RETIREMENT_COPY.depositsOnly, RETIREMENT_COPY.chooseReturn]); expect(content.secondary).not.toContain(content.primary);
    });
    it(`that path builds a balances scenario with no growth and calculates a labelled no-growth illustration only (${kind})`, () => {
      const review = reviewOf(withReturn(kind)), built = buildRetirementConfirmation(review, { ...stored, returns: { kind: "no-growth" } });
      if (!built.ok) throw new Error(built.reason);
      expect(built.scenario.assumptions).toMatchObject({ view: "balances", returns: { kind: "no-growth" } });
      const calc = calculateRetirementScenario(built.scenario); if (calc.kind !== "preview") throw new Error("expected a preview");
      const content = retirementResultContent(calc);
      expect(content.rows.map(r => r.label)).toEqual(["No investment growth"]); expect(content.fallback).toBe("No investment growth forecast was made."); expect(content.canExplore).toBe(false);
      expect(validateRetirementScreen({ stage: "result", calculation: calc }, parse)).toEqual({ ok: true });
    });
  }
  it("the recorded value and a contribution basis decide the offer: no value means exact deposits only; no contribution asks for an amount first", () => {
    const noValue = retirementReviewContent(reviewOf(r => { withReturn("missing")(r); r.context.currentValue = null; }));
    expect(noValue.primary).toBe(RETIREMENT_COPY.depositsOnly); expect(noValue.secondary).toEqual([]);
    const noAmount = retirementReviewContent(reviewOf(r => { withReturn("missing")(r); r.context.contribution = { kind: "missing" }; }));
    expect(noAmount.primary).toBe(RETIREMENT_COPY.noGrowthBalance); expect(noAmount.needs).toEqual(["contribution"]);
    expect(buildRetirementConfirmation(reviewOf(r => { withReturn("missing")(r); r.context.contribution = { kind: "missing" }; }), { ...stored, returns: { kind: "no-growth" } })).toMatchObject({ ok: false });
    expect(buildRetirementConfirmation(reviewOf(r => { withReturn("missing")(r); r.context.contribution = { kind: "missing" }; }), { ...stored, returns: { kind: "no-growth" }, contribution: { basis: "manual", amount: "0" } })).toMatchObject({ ok: true });
  });
  it("a recorded zero value still allows the no-growth balance (zero is not missing)", () => {
    expect(retirementReviewContent(reviewOf(r => { withReturn("missing")(r); r.context.currentValue = "0"; })).primary).toBe(RETIREMENT_COPY.noGrowthBalance);
  });
  it("a saved return and a stated return keep their own primaries", () => {
    expect(retirementReviewContent(reviewOf()).primary).toBe(RETIREMENT_COPY.usePlan);
    expect(retirementReviewContent(reviewOf(r => { withReturn("missing")(r); r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; })).primary).toBe("Use 5% a year, as you asked");
  });
  it("the offer never uses forbidden wording and never says a default was chosen", () => {
    const { candidates: _c, ...shown } = retirementReviewContent(reviewOf(withReturn("application-default")));
    expect(JSON.stringify(shown)).not.toMatch(FORBIDDEN_RETIREMENT_WORDING);
  });
});

describe("R2-3 a deposits-only result never offers a return the person cannot use", () => {
  const noValueDeposits = () => {
    const input = examples()[0].input; input.context.currentValue = null; input.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
    const result = calculateRetirementScenario(input); if (result.kind !== "extra-deposits-only") throw new Error("expected deposits only"); return result;
  };
  it("with a recorded value it still offers to choose a return, as its primary action", () => {
    const content = retirementDepositsOnlyContent(depositsOnly());
    expect(content.primary).toBe(RETIREMENT_COPY.chooseReturn); expect(content.offers).toEqual([RETIREMENT_COPY.chooseReturn]);
  });
  it("with no recorded value it offers nothing that leads nowhere: the primary is Change the details and there are no offers", () => {
    const content = retirementDepositsOnlyContent(noValueDeposits());
    expect(content.primary).toBe("Change the details"); expect(content.offers).toEqual([]);
    expect(JSON.stringify(content)).not.toMatch(/Choose a return assumption/);
    expect(content.exactDeposits).toContain("$50.00"); expect(content.fallback).toBe("No investment growth forecast was made.");
  });
  it("the same holds for a recorded zero value: a return can be chosen because a balance can be shown", () => {
    const input = examples()[0].input; input.context.currentValue = "0"; input.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
    const result = calculateRetirementScenario(input); if (result.kind !== "extra-deposits-only") throw new Error("expected deposits only");
    expect(retirementDepositsOnlyContent(result).primary).toBe(RETIREMENT_COPY.chooseReturn);
  });
  it("the review with no recorded value offers no return choice either", () => {
    const content = retirementReviewContent(reviewOf(r => { r.context.currentValue = null; r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; }));
    expect(content.secondary).toEqual([]); expect(content.primary).toBe(RETIREMENT_COPY.depositsOnly);
  });
});

describe("R2-2 malformed account lists neither crash validation nor pass it", () => {
  const good = { id: 7, name: "Fictional IRA" };
  const badRosters: [string, unknown][] = [
    ["null", null], ["undefined", undefined], ["a string", "x"], ["an object", { 0: good, length: 1 }],
    ["a null entry", [null]], ["a number entry", [5]], ["an entry missing its name", [{ id: 7 }]], ["a string id", [{ id: "7", name: "Fictional IRA" }]],
    ["a zero id", [{ id: 0, name: "Fictional IRA" }]], ["a blank name", [{ id: 7, name: " " }]], ["an extra key on an entry", [{ ...good, type: "investment" }]],
    ["duplicate ids", [good, { id: 7, name: "Other" }]], ["a sparse array", [, good]], ["a hidden field on the array", Object.defineProperty([good], "hidden", { value: 1 })],
    ["a symbol field on the array", Object.assign([good], { [Symbol("x")]: 1 })], ["a hidden field on an entry", [Object.defineProperty({ ...good }, "hidden", { value: 1 })]],
    ["an array subclass", Object.setPrototypeOf([good], class extends Array {}.prototype)],
  ];
  const stagesOf = () => Object.entries(screens());
  for (const [label, roster] of badRosters) it(`refuses ${label} as the live roster on every stage, without throwing`, () => {
    for (const [name, screen] of stagesOf()) {
      let out: unknown; expect(() => { out = validateRetirementScreen(screen, { today: parse.today, investmentAccounts: roster as never }); }, `${name} threw`).not.toThrow();
      expect(out, name).toMatchObject({ ok: false });
    }
  });
  it("refuses a malformed parse context as a whole", () => {
    for (const context of [null, undefined, "x", [], { today: parse.today }, { investmentAccounts: parse.investmentAccounts }, { today: "2026-13-01", investmentAccounts: parse.investmentAccounts },
      { today: 5, investmentAccounts: parse.investmentAccounts }, { ...parse, extra: 1 }, Object.defineProperty({ ...parse }, "hidden", { value: 1 })])
      for (const [name, screen] of stagesOf()) { let out: unknown; expect(() => { out = validateRetirementScreen(screen, context as never); }, name).not.toThrow(); expect(out, name).toMatchObject({ ok: false }); }
  });
  const choices = () => screens().choices as Extract<RetirementScreen, { stage: "choices" }>;
  const badCardRosters: [string, unknown][] = [
    ["null", null], ["not an array", {}], ["a null entry", [null]], ["a missing name", [{ id: 7 }]], ["a string id", [{ id: "7", name: "Fictional IRA" }]], ["an extra key", [{ ...good, x: 1 }]],
    ["a hole", [, good]], ["a hidden field on the array", Object.defineProperty([good], "hidden", { value: 1 })], ["a hidden field on an entry", [Object.defineProperty({ ...good }, "hidden", { value: 1 })]],
    ["a duplicate", [good, good]], ["an extra account", [good, { id: 8, name: "Other" }]], ["a different name", [{ id: 7, name: "Renamed" }]], ["no accounts", []],
  ];
  for (const [label, accounts] of badCardRosters) it(`refuses ${label} in the choices card's own account list without throwing`, () => {
    let out: unknown; expect(() => { out = validateRetirementScreen({ ...choices(), accounts } as never, parse); }).not.toThrow(); expect(out).toMatchObject({ ok: false });
  });
  it("still accepts a valid roster, including more than one account in the same order, and an empty one where no account is needed", () => {
    expect(validateRetirementScreen(screens().choices, parse)).toEqual({ ok: true });
    const two = { today: parse.today, investmentAccounts: [good, { id: 8, name: "Other" }] };
    expect(validateRetirementScreen({ ...choices(), accounts: two.investmentAccounts }, two)).toEqual({ ok: true });
    expect(validateRetirementScreen({ ...choices(), accounts: [...two.investmentAccounts].reverse() }, two)).toMatchObject({ ok: false });
    expect(validateRetirementScreen({ stage: "error", message: "I couldn't read that account right now." }, { today: parse.today, investmentAccounts: [] })).toEqual({ ok: true });
  });
  it("the consent builder, the choices event and the review builder refuse a malformed roster too", () => {
    const bad = { today: parse.today, investmentAccounts: [null] as never };
    expect(() => validateRetirementChoicesEvent({ step: "account", draft: draft({ accountId: 7, missing: ["start-date", "retirement-month"] }) }, bad)).not.toThrow();
    expect(validateRetirementChoicesEvent({ step: "account", draft: draft({ accountId: 7, missing: ["start-date", "retirement-month"] }) }, bad)).toMatchObject({ ok: false });
    expect(() => buildRetirementReview({ step: "complete", intent: examples()[0].input.intent, monthSource: "question", questionAssumptions: { annualReturnPct: null, inflationPct: null } }, { context: examples()[0].input.context, inflation: { kind: "missing" } }, bad)).not.toThrow();
    expect(buildRetirementReview({ step: "complete", intent: examples()[0].input.intent, monthSource: "question", questionAssumptions: { annualReturnPct: null, inflationPct: null } }, { context: examples()[0].input.context, inflation: { kind: "missing" } }, bad)).toMatchObject({ ok: false });
  });
});

describe("R2-4 extra, hidden and symbol fields on arrays inside a result are refused", () => {
  type Any = Record<string, any>;
  const run = (calc: unknown, stage: "result" | "explore" = "result") => validateRetirementScreen({ stage, calculation: calc }, parse);
  const withRates = () => preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "-5", base: "12", higher: "20" } }; }) as unknown as Any;
  const cases: [string, (c: Any) => void][] = [
    ["a projection's points array (extra field)", c => { c.noGrowth.baseline.points.note = "x"; }],
    ["a projection's points array (hidden field)", c => { Object.defineProperty(c.noGrowth.baseline.points, "hidden", { value: 1 }); }],
    ["a projection's points array (symbol field)", c => { c.noGrowth.scenario.points[Symbol("x")] = 1; }],
    ["the confirmed-return points array", c => { Object.defineProperty(c.confirmedReturn.baseline.points, "hidden", { value: 1 }); }],
    ["a withdrawals array", c => { Object.defineProperty(c.noGrowth.baseline.withdrawals, "hidden", { value: 1 }); }],
    ["the sensitivity array", c => { Object.defineProperty(c.sensitivity, "hidden", { value: 1 }); }],
    ["a sensitivity illustration's points", c => { Object.defineProperty(c.sensitivity[0].baseline.points, "hidden", { value: 1 }); }],
    ["a hole in the points array", c => { delete c.noGrowth.baseline.points[1]; }],
    ["an array subclass for points", c => { Object.setPrototypeOf(c.noGrowth.baseline.points, class extends Array {}.prototype); }],
  ];
  for (const [label, edit] of cases) it(`rejects ${label}`, () => { const c = withRates(); edit(c); expect(run(c, "explore")).toMatchObject({ ok: false }); });
  it("still accepts the untouched result with its arrays", () => { expect(run(withRates(), "explore")).toEqual({ ok: true }); expect(run(preview())).toEqual({ ok: true }); });
  it("rejects a hidden field on an array inside the confirmed scenario's own context or intent", () => {
    const c = preview() as unknown as Any; Object.defineProperty(c.scenario.context, "extra", { value: [] }); expect(run(c)).toMatchObject({ ok: false });
  });
});

// ---- Stage 3 (answer screen): contract additions the dialog needs. All wording stays here, none in the component. ---------------------------------------------------
describe("S3 choices card copy (D3)", () => {
  it("introduces what was understood, never claims a result, and says what happens next", () => {
    expect(retirementChoicesIntro(draft({ accountId: null, extra: { kind: "monthly", amount: "50" } }))).toBe("Nothing has been calculated yet. I understood: an extra $50 each month, starting today. I will read the account you pick, then show you the details to confirm.");
    expect(retirementChoicesIntro(draft({ accountId: 7, extra: { kind: "once", amount: "5000" } }))).toBe("Nothing has been calculated yet. I understood: a one-time $5,000, starting today. I will show you the details to confirm.");
    expect(retirementChoicesIntro(draft({ accountId: null, extra: { kind: null, amount: "50.50" } }))).toBe("Nothing has been calculated yet. I understood: an extra $50.50, starting today. I will read the account you pick, then show you the details to confirm.");
    expect(retirementChoicesIntro(draft({ accountId: 7, extra: { kind: null, amount: null } }))).toBe("Nothing has been calculated yet. I will show you the details to confirm.");
  });
  it("never uses forbidden wording", () => { for (const extra of [{ kind: "monthly" as const, amount: "50" }, { kind: null, amount: null }]) expect(retirementChoicesIntro(draft({ extra }))).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); });
  it("tells accounts with the same name apart, in list order, and leaves unique names alone", () => {
    expect(retirementAccountLabels([{ id: 5, name: "Roth IRA" }, { id: 6, name: "Roth IRA" }, { id: 8, name: "Brokerage" }])).toEqual([
      { id: 5, label: "Roth IRA (1 of 2)" }, { id: 6, label: "Roth IRA (2 of 2)" }, { id: 8, label: "Brokerage" }]);
    expect(retirementAccountLabels([])).toEqual([]);
    expect(retirementAccountLabels([{ id: 1, name: "A" }, { id: 2, name: "a" }])).toEqual([{ id: 1, label: "A" }, { id: 2, label: "a" }]); // case differences are different names
  });
  it("names every control on the card in plain words", () => {
    expect(RETIREMENT_CHOICE_COPY).toEqual({ extraAmount: "Extra amount (dollars)", monthly: "Every month", once: "Just once", startToday: "Start today instead" });
    expect(retirementUsePlanMonth("2050-06")).toBe("Use June 2050, from your plan");
  });
  it("freezes the problem sentences and reuses the builder's own", () => {
    expect(RETIREMENT_PROBLEMS).toEqual({
      extraAmount: "Enter the amount as dollars and cents, like 50 or 50.25.", manualAmount: "Enter the amount as dollars and cents, like 100 or 100.50.", return: "Enter a yearly return from -100% to 100%.",
      inflation: "Enter yearly inflation from 0% to 100%.", otherReturns: "Enter returns from -100 to 100, lowest first.", month: "Choose a retirement month from this month on, within the next 100 years.",
    });
    const reason = (choices: RetirementChoices) => { const out = buildRetirementConfirmation(reviewOf(), choices); if (out.ok) throw new Error("expected refusal"); return out.reason; };
    expect(reason({ ...stored, contribution: { basis: "manual", amount: "abc" } })).toBe(RETIREMENT_PROBLEMS.manualAmount);
    expect(reason({ ...stored, returns: { kind: "explicit", annualPct: "150" } })).toBe(RETIREMENT_PROBLEMS.return);
    expect(reason({ ...stored, purchasingPower: { kind: "today", inflationPct: "101" } })).toBe(RETIREMENT_PROBLEMS.inflation);
    expect(reason({ ...stored, sensitivity: { lower: "13", base: "12", higher: "20" } })).toBe(RETIREMENT_PROBLEMS.otherReturns);
    for (const sentence of Object.values(RETIREMENT_PROBLEMS)) { expect(sentence).toMatch(/\.$/); expect(sentence).not.toMatch(FORBIDDEN_RETIREMENT_WORDING); }
  });
});

describe("S3 review notices (D5, U4)", () => {
  it("says why only deposits are offered when there is no recorded value", () => {
    expect(retirementReviewContent(reviewOf(r => { r.context.currentValue = null; })).notice).toEqual({ tone: "warn", text: "There is no recorded value for this account, so I can only show the extra deposits." });
  });
  it("says no return was chosen for the person when only the no-growth balance is offered", () => {
    for (const kind of ["application-default", "missing"] as const) {
      const content = retirementReviewContent(reviewOf(r => { r.context.returnAssumption = kind === "missing" ? { kind: "missing" } : { kind, annualPct: "7" }; }));
      expect(content.notice).toEqual({ tone: "warn", text: "No saved return was found, and I haven't picked one for you. You can see the balance with no investment growth, or choose a return." });
    }
  });
  it("has no notice for a complete saved plan or a stated return", () => {
    expect(retirementReviewContent(reviewOf()).notice).toBeNull();
    expect(retirementReviewContent(reviewOf(r => { r.context.returnAssumption = { kind: "missing" }; r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; })).notice).toBeNull();
  });
  it("never uses forbidden wording", () => {
    for (const patch of [(r: RetirementReview) => { r.context.currentValue = null; }, (r: RetirementReview) => { r.context.returnAssumption = { kind: "missing" }; }])
      expect(JSON.stringify(retirementReviewContent(reviewOf(patch)).notice)).not.toMatch(FORBIDDEN_RETIREMENT_WORDING);
  });
});

describe("S3 the review form becomes choices, and only the builder can accept them (D5, D1)", () => {
  const form = (over: Partial<RetirementReviewForm> = {}): RetirementReviewForm => ({ amount: "", chooseReturn: false, returnPct: "", todays: false, inflation: null, ...over });
  it("the primary action of a saved plan confirms the saved return and the saved amount", () => {
    expect(retirementReviewChoices(reviewOf(), form(), "primary")).toEqual(stored);
  });
  it("a typed return replaces the saved one only when the person chose to enter one", () => {
    expect(retirementReviewChoices(reviewOf(), form({ chooseReturn: true, returnPct: "5" }), "primary").returns).toEqual({ kind: "explicit", annualPct: "5" });
    expect(retirementReviewChoices(reviewOf(), form({ returnPct: "5" }), "primary").returns).toEqual({ kind: "stored-plan" });
  });
  it("a missing recorded value never turns into a typed return", () => {
    expect(retirementReviewChoices(reviewOf(r => { r.context.currentValue = null; }), form({ chooseReturn: true, returnPct: "5" }), "primary")).toEqual({ view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth" }, sensitivity: null, purchasingPower: { kind: "nominal" } });
  });
  it("with no usable return and a recorded value the primary confirms a balances view with no growth", () => {
    expect(retirementReviewChoices(reviewOf(r => { r.context.returnAssumption = { kind: "application-default", annualPct: "7" }; }), form(), "primary")).toMatchObject({ view: "balances", returns: { kind: "no-growth" } });
  });
  it("a stated return is used as an explicit return, and the saved plan stays available as its own action", () => {
    const review = reviewOf(r => { r.questionAssumptions = { annualReturnPct: "5", inflationPct: null }; });
    expect(retirementReviewChoices(review, form(), "primary").returns).toEqual({ kind: "explicit", annualPct: "5" });
    expect(retirementReviewChoices(review, form(), "plan").returns).toEqual({ kind: "stored-plan" });
  });
  it("the deposits action is always the exact-deposits view", () => {
    expect(retirementReviewChoices(reviewOf(), form({ todays: true, amount: "5", chooseReturn: true, returnPct: "5" }), "deposits")).toEqual({ view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth" }, sensitivity: null, purchasingPower: { kind: "nominal" } });
  });
  it("a missing contribution uses the typed amount as a manual amount; a recorded one is used as recorded", () => {
    const none = reviewOf(r => { r.context.contribution = { kind: "missing" }; });
    expect(retirementReviewChoices(none, form({ amount: "0" }), "primary").contribution).toEqual({ basis: "manual", amount: "0" });
    expect(retirementReviewChoices(reviewOf(), form({ amount: "999" }), "primary").contribution).toEqual({ basis: "context" });
  });
  it("today's dollars uses the typed inflation, or the candidate when none was typed", () => {
    expect(retirementReviewChoices(reviewOf(), form({ todays: true, inflation: "2" }), "primary").purchasingPower).toEqual({ kind: "today", inflationPct: "2" });
    expect(retirementReviewChoices(reviewOf(), form({ todays: true }), "primary").purchasingPower).toEqual({ kind: "today", inflationPct: "3" });
    expect(retirementReviewChoices(reviewOf(r => { r.inflation = { kind: "missing" }; }), form({ todays: true }), "primary").purchasingPower).toEqual({ kind: "today", inflationPct: "" });
    expect(retirementReviewChoices(reviewOf(r => { r.context.currentValue = null; }), form({ todays: true, inflation: "2" }), "primary").purchasingPower).toEqual({ kind: "nominal" });
  });
  it("whatever it returns, an unusable value is refused by the builder, never repaired", () => {
    const bad = (f: Partial<RetirementReviewForm>) => buildRetirementConfirmation(reviewOf(), retirementReviewChoices(reviewOf(), form(f), "primary"));
    expect(bad({ chooseReturn: true, returnPct: "150" })).toMatchObject({ ok: false, reason: RETIREMENT_PROBLEMS.return });
    expect(bad({ todays: true, inflation: "101" })).toMatchObject({ ok: false, reason: RETIREMENT_PROBLEMS.inflation });
    expect(bad({ chooseReturn: true, returnPct: "" })).toMatchObject({ ok: false });
  });
});

describe("S3 choosing another month on the review (D5, R-4)", () => {
  it("replaces the month, marks it as typed, and leaves the original review untouched", () => {
    const review = reviewOf(r => { r.monthSource = "plan-candidate"; }), copy = structuredClone(review);
    const out = withRetirementMonth(review, "2055-03");
    expect(out).toMatchObject({ ok: true }); if (out.ok) { expect(out.review.intent.retirementMonth).toBe("2055-03"); expect(out.review.monthSource).toBe("typed"); expect(out.review.context.retirementMonth).toBe(review.context.retirementMonth); }
    expect(review).toEqual(copy);
  });
  it("refuses a past month, a month beyond 100 years, and anything that is not a year and month", () => {
    for (const month of ["2026-09", "2101-01", "2200-01", "2055-13", "2055-3", "March 2055", "", "2055-03-01", "20550-01"]) expect(withRetirementMonth(reviewOf(), month), month).toEqual({ ok: false, reason: RETIREMENT_PROBLEMS.month });
    expect(withRetirementMonth(reviewOf(), 5 as never)).toEqual({ ok: false, reason: RETIREMENT_PROBLEMS.month });
  });
  it("accepts this month (a zero horizon) and the last supported month", () => {
    expect(withRetirementMonth(reviewOf(), "2026-10")).toMatchObject({ ok: true });
    expect(withRetirementMonth(reviewOf(), "2100-12")).toMatchObject({ ok: true });
  });
  it("refuses a malformed review instead of throwing", () => { for (const review of [null, {}, { ...reviewOf(), context: null }]) expect(() => withRetirementMonth(review as never, "2055-03")).not.toThrow(); expect(withRetirementMonth(null as never, "2055-03")).toMatchObject({ ok: false }); });
});

describe("S3 exploring other returns is a new consent built from the shown result (D7, U5)", () => {
  const confirmedPreview = (rate = "12", basis: "stored-plan" | "explicit" = "stored-plan") => preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: rate, basis, sensitivity: null }; });
  it("adds the three rates to a copy of the confirmed scenario and nothing else", () => {
    const calc = confirmedPreview(), out = buildExploreConfirmation(calc, { lower: "3", base: "12", higher: "20" });
    if (!out.ok) throw new Error(out.reason);
    const expected = structuredClone(calc.scenario); (expected.assumptions.returns as { sensitivity: unknown }).sensitivity = { lower: "3", base: "12", higher: "20" };
    expect(out.scenario).toEqual(expected);
    const live = { today: "2026-10-17", source: calc.scenario.context.source, investmentAccounts: [{ id: 7, name: "Fictional IRA" }] };
    expect(validateConfirmedRetirementScenario(out.scenario, live)).toEqual({ ok: true });
  });
  it("never shares objects with, or changes, the result it was built from", () => {
    const calc = confirmedPreview(), copy = structuredClone(calc), out = buildExploreConfirmation(calc, { lower: "3", base: "12", higher: "20" }); if (!out.ok) throw new Error(out.reason);
    out.scenario.intent.extra.amount = "999"; expect(calc).toEqual(copy);
  });
  it("works for an explicit return and keeps its basis; equal rates are allowed", () => {
    const out = buildExploreConfirmation(confirmedPreview("5", "explicit"), { lower: "5", base: "5", higher: "5" });
    expect(out).toMatchObject({ ok: true }); if (out.ok) expect(out.scenario.assumptions.returns).toMatchObject({ basis: "explicit", annualPct: "5" });
  });
  it("refuses other returns without a confirmed return, and when they are already shown", () => {
    expect(buildExploreConfirmation(preview(s => { s.assumptions.returns = { kind: "no-growth" }; }), { lower: "1", base: "2", higher: "3" })).toEqual({ ok: false, reason: "Other returns need a confirmed return first." });
    const already = preview(s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: { lower: "3", base: "12", higher: "20" } }; });
    expect(buildExploreConfirmation(already, { lower: "1", base: "12", higher: "20" })).toMatchObject({ ok: false });
  });
  for (const [label, sensitivity] of [["a lower rate above the confirmed rate", { lower: "13", base: "12", higher: "20" }], ["a higher rate below the confirmed rate", { lower: "3", base: "12", higher: "11" }],
    ["a base that differs from the confirmed rate", { lower: "3", base: "11", higher: "20" }], ["a rate above 100", { lower: "3", base: "12", higher: "101" }], ["a rate below -100", { lower: "-101", base: "12", higher: "20" }],
    ["text", { lower: "abc", base: "12", higher: "20" }], ["an empty rate", { lower: "", base: "12", higher: "20" }], ["numbers instead of text", { lower: 3, base: 12, higher: 20 }], ["a missing key", { lower: "3", base: "12" }],
    ["an extra key", { lower: "3", base: "12", higher: "20", mid: "5" }], ["null", null]] as [string, unknown][])
    it(`refuses ${label} in plain words and never throws`, () => {
      let out: ReturnType<typeof buildExploreConfirmation> | undefined; expect(() => { out = buildExploreConfirmation(confirmedPreview(), sensitivity as never); }).not.toThrow();
      expect(out).toMatchObject({ ok: false }); expect((out as { reason: string }).reason).toMatch(/\.$/);
    });
  it("refuses a result that is not a validated preview: altered terms, a deposits-only result, and malformed input", () => {
    const altered = confirmedPreview() as unknown as { scenario: { intent: { extra: { amount: string } } } }; altered.scenario.intent.extra.amount = "-5";
    expect(buildExploreConfirmation(altered as never, { lower: "3", base: "12", higher: "20" })).toMatchObject({ ok: false });
    expect(buildExploreConfirmation(depositsOnly() as never, { lower: "3", base: "12", higher: "20" })).toMatchObject({ ok: false });
    for (const bad of [null, {}, { kind: "preview" }, { kind: "preview", scenario: null }]) expect(() => buildExploreConfirmation(bad as never, { lower: "3", base: "12", higher: "20" })).not.toThrow();
    expect(buildExploreConfirmation(null as never, { lower: "3", base: "12", higher: "20" })).toMatchObject({ ok: false });
  });
});

describe("S3 the last two sentences the dialog needs", () => {
  it("names the way back from exploring and what is said when a screen cannot be shown", () => {
    expect(RETIREMENT_COPY.backToResult).toBe("Back to the result");
    expect(RETIREMENT_INVALID_SCREEN_MESSAGE).toBe("I couldn't show that. Nothing was calculated.");
    expect(RETIREMENT_INVALID_SCREEN_MESSAGE).not.toMatch(FORBIDDEN_RETIREMENT_WORDING);
  });
});

describe("S3 helpers so the choices card holds no logic or copy of its own", () => {
  const today = "2026-10-17";
  it("fills only the answers asked for, keeps the rest, and recomputes what is still missing", () => {
    const d = draft({ accountId: null, extra: { kind: null, amount: null }, startDate: null, retirementMonth: null, missing: ["account", "extra-amount", "cadence", "start-date", "retirement-month"] });
    const out = retirementDraftWithAnswers(d, { accountId: 7, amount: "75.5", cadence: "once", startToday: true }, today);
    expect(out).toMatchObject({ accountId: 7, extra: { kind: "once", amount: "75.5" }, startDate: today, retirementMonth: null, missing: ["retirement-month"], sourceText: d.sourceText });
    expect(validateRetirementDraft(out, { today, investmentAccounts: [{ id: 7, name: "Fictional IRA" }] })).toEqual({ ok: true });
  });
  it("never overrides what the question already said, and leaves a stated later start open until it is acknowledged", () => {
    const d = draft({ accountId: 7, extra: { kind: "monthly", amount: "50" }, startDate: null, retirementMonth: "2050-06", missing: ["start-date"], assumptions: { annualReturnPct: "5", inflationPct: null } });
    expect(retirementDraftWithAnswers(d, { accountId: 8, amount: "99", cadence: "once", startToday: false }, today)).toMatchObject({ accountId: 7, extra: { kind: "monthly", amount: "50" }, startDate: null, missing: ["start-date"], assumptions: { annualReturnPct: "5" } });
    expect(retirementDraftWithAnswers(d, { accountId: null, amount: null, cadence: null, startToday: true }, today)).toMatchObject({ startDate: today, missing: [], retirementMonth: "2050-06" });
  });
  it("does not change its input and leaves unanswered items missing", () => {
    const d = draft({ accountId: null, extra: { kind: null, amount: null }, missing: ["account", "extra-amount", "cadence", "start-date", "retirement-month"], startDate: null }), copy = structuredClone(d);
    const out = retirementDraftWithAnswers(d, { accountId: null, amount: "5", cadence: null, startToday: false }, today);
    expect(d).toEqual(copy); expect(out.missing).toEqual(["account", "cadence", "start-date", "retirement-month"]); expect(out.extra).toEqual({ kind: null, amount: "5" });
  });
  it("the review lists what is left out and that nothing changes", () => {
    expect(retirementReviewContent(reviewOf()).details).toEqual(["Taxes, fees, an employer match and contribution limits are not included.", "Nothing in your accounts is changed."]);
  });
  it("has one sentence for nothing calculated, and exploring uses the shared sentence for a bad pair of rates", () => {
    expect(RETIREMENT_COPY.nothingCalculated).toBe("Nothing was calculated."); expect(retirementExploreContent().problem).toBe(RETIREMENT_PROBLEMS.otherReturns);
  });
});

describe("S3 the last small pieces of copy and one check", () => {
  it("says whether a typed month is usable on a given day: a real year and month, this month or later, within 100 years", () => {
    for (const month of ["2026-10", "2055-03", "2100-12"]) expect(retirementMonthUsable(month, "2026-10-17"), month).toBe(true);
    for (const month of ["2026-09", "2101-01", "2055-13", "2055-3", "", "March 2055", "2055-03-01", "20550-01", null, undefined, 5]) expect(retirementMonthUsable(month, "2026-10-17"), String(month)).toBe(false);
    expect(retirementMonthUsable("2026-10", "not a day")).toBe(false);
  });
  it("names the disclosure and the table columns", () => {
    expect(RETIREMENT_COPY.detailsSummary).toBe("What this includes and leaves out");
    expect(RETIREMENT_TABLE_HEADERS).toEqual({ assumption: "Assumption", without: "Without the extra", with: "With the extra", difference: "Difference" });
  });
});
