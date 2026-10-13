// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatementReviewDialog, canFinish, foldHoldings, initialChoices, type FinishState } from "./StatementReviewDialog";
import { sampleReview } from "./statementTestUtils";
import { formatDisplayDate } from "./format";
import type { FinishDecisions, StatementReview } from "./statementContracts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const noop = () => {};
type Handlers = Partial<Record<"onFlip" | "onTeach" | "onUseDownload" | "onReconcileByHand" | "onFinish" | "onCancel", Mock<(...args: unknown[]) => void>>>;

function dialog(review: StatementReview, h: Handlers = {}, extra: { busy?: boolean; error?: string | null } = {}) {
  return (
    <StatementReviewDialog
      review={review}
      accountName="Card"
      busy={extra.busy ?? false}
      error={extra.error ?? null}
      onFlip={h.onFlip ?? noop}
      onTeach={h.onTeach ?? noop}
      onUseDownload={h.onUseDownload ?? noop}
      onReconcileByHand={h.onReconcileByHand ?? noop}
      onFinish={h.onFinish ?? noop}
      onCancel={h.onCancel ?? noop}
    />
  );
}

async function render(review = sampleReview(), h: Handlers = {}, extra: { busy?: boolean; error?: string | null } = {}) {
  const onFinish: Mock<(...args: unknown[]) => void> = h.onFinish ?? vi.fn();
  await act(async () => root.render(dialog(review, { ...h, onFinish }, extra)));
  return onFinish;
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & Element>(sel) as T | null;
const finishButton = () => q<HTMLButtonElement>("[data-statement-finish]")!;
const text = () => document.body.textContent ?? "";
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
}
async function type(el: Element | null, value: string) {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function lastDecisions(onFinish: Mock<(...args: unknown[]) => void>): FinishDecisions {
  return onFinish.mock.calls[onFinish.mock.calls.length - 1][0] as FinishDecisions;
}

const base = (review: StatementReview, over: Partial<FinishState> = {}): FinishState => ({
  choices: initialChoices(review),
  start: review.starting_balance ?? "",
  end: review.ending_balance ?? "",
  holdings: new Map(),
  finishWithoutHoldings: false,
  ...over,
});

function investment(over: Partial<StatementReview> = {}): StatementReview {
  return sampleReview({
    account_kind: "investment",
    starting_balance: null,
    ending_balance: null,
    learnable: false,
    rows: [],
    app_transactions: [],
    holdings_check: { outcome: "passed", expected: "3152.63", found: "3152.63" },
    holdings: [
      { symbol: "QQQZ", name: "Tracker", statement_shares: "10.5", price: "300.25", market_value: "3152.63", app_holding_id: 4, app_shares: "10", status: "different" },
    ],
    ...over,
  });
}

function loan(over: Partial<StatementReview> = {}): StatementReview {
  return sampleReview({
    token: "tok-loan",
    account_kind: "loan",
    learnable: false,
    starting_balance: "1000.00",
    ending_balance: "600.00",
    rows: [
      { index: 0, date: "2026-07-24", description: "PAYMENT", amount: "500.00", principal: "400.00", status: "matched", match_id: 11, possible_ids: [] },
    ],
    // The app holds the payment at its full amount (no principal part yet), so on its own it moves the loan by -500.
    app_transactions: [{ id: 11, date: "2026-07-24", description: "Loan payment", amount: "500.00", change: "-500.00" }],
    ...over,
  });
}

describe("initialChoices", () => {
  it("matched rows start matched and missing rows start as Add", () => {
    const choices = initialChoices(sampleReview());
    expect(choices.get(0)).toEqual({ kind: "match", transactionId: 11 });
    expect(choices.get(1)).toMatchObject({ kind: "add", description: "CLOUD STORAGE" });
  });

  it("nothing starts as Add when the period was already reconciled", () => {
    const review = sampleReview({
      already_reconciled_through: "2026-08-31",
      rows: [
        ...sampleReview().rows,
        { index: 2, date: "2026-09-02", description: "LATER", amount: "-1.00", principal: null, status: "missing", match_id: null, possible_ids: [] },
      ],
    });
    const choices = initialChoices(review);
    expect(choices.get(0)).toEqual({ kind: "match", transactionId: 11 });
    expect(choices.get(1)).toBeUndefined();
    expect(choices.get(2)).toBeUndefined();
    expect([...choices.values()].some((c) => c.kind === "add")).toBe(false);
  });

  it("leaves possible matches for the person to choose", () => {
    const review = sampleReview({
      rows: [{ index: 0, date: "2026-07-24", description: "STREAMING", amount: "-7.40", principal: null, status: "possible", match_id: null, possible_ids: [11] }],
    });
    expect(initialChoices(review).get(0)).toBeUndefined();
  });
});

describe("canFinish", () => {
  it("finishes only when the difference is exactly zero", () => {
    // start 43.08 + matched 7.40 (owed up) + added 11.99 (owed up) = 62.47 ≠ 52.36
    const review = sampleReview();
    const off = canFinish(review, base(review, { start: "43.08", end: "52.36" }));
    expect(off).toMatchObject({ ok: false, difference: "-10.11" });
    expect(off.reason).toContain("$0.00");
    expect(canFinish(review, base(review, { start: "43.08", end: "62.47" }))).toEqual({ ok: true, reason: null, difference: "0.00" });
  });

  it("adds up exactly, with no rounding drift (0.10 + 0.20 is 0.30)", () => {
    const review = sampleReview({
      starting_balance: "0.10",
      ending_balance: "0.30",
      rows: [{ index: 0, date: "2026-08-01", description: "A", amount: "-0.20", principal: null, status: "missing", match_id: null, possible_ids: [] }],
      app_transactions: [],
    });
    expect(canFinish(review, base(review)).ok).toBe(true);
    expect(canFinish(review, base(review, { end: "0.3001" }))).toMatchObject({ ok: false, difference: "0.0001" });
  });

  it("refuses balances that aren't plain amounts, without throwing", () => {
    const review = sampleReview();
    for (const end of ["", "abc", "1e3", "+62.47", "62.47001", "1,062.47"]) {
      const r = canFinish(review, base(review, { end }));
      expect(r.ok).toBe(false);
      expect(r.difference).toBeNull();
      expect(r.reason).toMatch(/balance/i);
    }
  });

  it("picks up from the last reconciliation instead of the starting balance when there is one", () => {
    const review = sampleReview({ previous_ending_balance: "43.08", starting_balance: "999.00", ending_balance: "62.47" });
    expect(canFinish(review, base(review, { start: "" })).ok).toBe(true);
  });

  it("needs a choice for every line, and no transaction matched twice", () => {
    const review = sampleReview({ ending_balance: "62.47" });
    const choices = initialChoices(review);
    choices.delete(1);
    expect(canFinish(review, base(review, { choices })).reason).toBe("Choose what to do with every line on your statement.");
    choices.set(1, { kind: "match", transactionId: 11 });
    expect(canFinish(review, base(review, { choices })).reason).toBe("One of your transactions is matched to two lines.");
  });

  it("needs a description for every added line", () => {
    const review = sampleReview({ ending_balance: "62.47" });
    const choices = initialChoices(review);
    choices.set(1, { kind: "add", description: "   " });
    expect(canFinish(review, base(review, { choices })).reason).toBe("Every transaction you add needs a description.");
  });

  it("counts a loan payment by the part that pays down what you owe, as the app does", () => {
    // The statement says 400 of the 500 payment lowers the loan: 1000 - 400 = 600.
    const review = loan();
    expect(canFinish(review, base(review))).toEqual({ ok: true, reason: null, difference: "0.00" });
    // An added payment does the same.
    const added = loan({ rows: [{ ...loan().rows[0], status: "missing", match_id: null }], app_transactions: [] });
    expect(canFinish(added, base(added))).toEqual({ ok: true, reason: null, difference: "0.00" });
  });

  it("counts a loan line at its full amount when the statement prints no separate part", () => {
    const review = loan({ ending_balance: "500.00", rows: [{ ...loan().rows[0], principal: null }] });
    expect(canFinish(review, base(review)).ok).toBe(true);
  });

  it("an investment needs every share count to match", () => {
    const review = investment();
    const holdings = (action: "leave" | "update") => new Map([["QQQZ", { action }]]);
    expect(canFinish(review, base(review, { holdings: holdings("leave") }))).toMatchObject({ ok: false, reason: "Update QQQZ to match your statement first." });
    expect(canFinish(review, base(review, { holdings: holdings("update") }))).toEqual({ ok: true, reason: null, difference: null });
  });

  it("an investment holding you add needs what you paid for it", () => {
    const review = investment({
      holdings: [{ symbol: "NEWZ", name: "New", statement_shares: "2", price: "10", market_value: "20", app_holding_id: null, app_shares: null, status: "missing_in_app" }],
    });
    const withCost = (costBasis?: string) => base(review, { holdings: new Map([["NEWZ", { action: "add" as const, costBasis }]]) });
    for (const bad of [undefined, "", "abc", "-5", "1e3"]) {
      expect(canFinish(review, withCost(bad))).toMatchObject({ ok: false, reason: "Enter what you paid in total for NEWZ." });
    }
    expect(canFinish(review, withCost("18.50")).ok).toBe(true);
    expect(canFinish(review, base(review, { holdings: new Map([["NEWZ", { action: "leave" as const }]]) })).reason).toBe(
      "Add NEWZ with what you paid for it first.",
    );
  });

  it("an investment whose holdings couldn't be read needs the person to finish without checking them", () => {
    const review = investment({ holdings_check: { outcome: "failed", expected: "3152.63", found: "3000.00" } });
    const update = new Map([["QQQZ", { action: "update" as const }]]);
    const r = canFinish(review, base(review, { holdings: update }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Finish without checking holdings");
    expect(canFinish(review, base(review, { holdings: update, finishWithoutHoldings: true })).ok).toBe(true);
  });

  it("an investment statement with no holdings total can't check share counts, so it needs the same tick", () => {
    const review = investment({ holdings_check: { outcome: "not_available", expected: null, found: null } });
    const r = canFinish(review, base(review, { holdings: new Map([["QQQZ", { action: "update" as const }]]) }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Finish without checking holdings");
    expect(r.reason).toContain("Investments");
    expect(canFinish(review, base(review, { finishWithoutHoldings: true })).ok).toBe(true);
  });

  it("an investment with no holdings anywhere has nothing to check", () => {
    const review = investment({ holdings_check: { outcome: "not_available", expected: null, found: null }, holdings: [], app_only_holdings: [] });
    expect(canFinish(review, base(review)).ok).toBe(true);
  });

  it("remembering the statement needs a name, a phrase, and the unread lines ignored", () => {
    const review = sampleReview({ ending_balance: "62.47", unread: [{ line: 3, text: "???" }] });
    const remember = { on: true, name: "Northwind", phrases: ["Northwind Card Services"] };
    expect(canFinish(review, base(review, { remember, ignoreUnread: true })).ok).toBe(true);
    expect(canFinish(review, base(review, { remember, ignoreUnread: false })).reason).toContain("Ignore the lines the app couldn't read");
    expect(canFinish(review, base(review, { remember: { ...remember, name: " " }, ignoreUnread: true })).reason).toContain("name");
    expect(canFinish(review, base(review, { remember: { ...remember, phrases: [] }, ignoreUnread: true })).reason).toContain("phrase");
    expect(canFinish(review, base(review, { remember: { ...remember, on: false } })).ok).toBe(true);
  });
});

describe("StatementReviewDialog", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("sends one decision per statement line and the phrases to remember", async () => {
    const onFinish = await render(sampleReview({ ending_balance: "62.47" }));
    expect(finishButton().disabled).toBe(false);
    expect(q("[data-difference]")!.getAttribute("data-balanced")).toBe("true");
    await click(finishButton());
    expect(onFinish).toHaveBeenCalledWith({
      matches: [{ row: 0, transactionId: 11 }],
      add: [{ row: 1, date: "2026-08-17", description: "CLOUD STORAGE", amount: "-11.99" }],
      skip: [],
      startingBalance: "43.08",
      endingBalance: "62.47",
      holdings: [],
      finishWithoutHoldings: false,
      ignoreUnread: false,
      saveLayout: { name: "Northwind Card Services", phrases: ["Northwind Card Services"] },
    });
  });

  it("shows the difference and keeps Finish off until it is zero", async () => {
    await render();
    expect(q("[data-difference]")!.textContent).toContain("-$10.11");
    expect(q("[data-difference]")!.getAttribute("data-balanced")).toBe("false");
    expect(finishButton().disabled).toBe(true);
    expect(text()).toContain("The difference has to be $0.00.");
    await type(q("[data-statement-review-end]"), "62.47");
    expect(finishButton().disabled).toBe(false);
  });

  it("shows a header with the part of the statement, the dates and what read it", async () => {
    await render(sampleReview({ section_name: "Card ending 1234", layout_name: "Northwind Card", recognized: true }));
    expect(text()).toContain("Card ending 1234");
    expect(text()).toContain("Read using: Northwind Card");
  });

  it("uses the credit card and loan balance words", async () => {
    await render();
    expect(text()).toContain("Amount owed at the start");
    expect(text()).toContain("Amount owed at the end");
    // A new review (its own token) starts the form over: the loan's own balances fill the fields.
    await render(loan());
    expect(text()).toContain("Amount you owed on the loan at the start");
    expect(text()).toContain("Amount you owed on the loan at the end");
    expect(q<HTMLInputElement>("[data-statement-review-end]")!.value).toBe("600.00");
    expect(q<HTMLInputElement>("[data-statement-review-start]")!.value).toBe("1000.00");
  });

  it("picks up from the last reconciliation when there is one", async () => {
    const onFinish = await render(sampleReview({ previous_ending_balance: "43.08", ending_balance: "62.47" }));
    expect(q("[data-statement-review-start]")).toBeNull();
    expect(text()).toContain("Picks up from your last reconciliation ($43.08)");
    await click(finishButton());
    expect(lastDecisions(onFinish).startingBalance).toBeNull();
  });

  it("offers teaching, the download and reconciling by hand when the statement doesn't add up", async () => {
    const h = { onTeach: vi.fn(), onUseDownload: vi.fn(), onReconcileByHand: vi.fn() };
    await render(sampleReview({ activity_check: { outcome: "failed", expected: "52.36", found: "60.00" } }), h);
    expect(text()).toContain("Some of this statement couldn't be read.");
    await click(q("[data-teach]"));
    await click(q("[data-use-download]"));
    await click(q("[data-reconcile-by-hand]"));
    expect(h.onTeach).toHaveBeenCalledTimes(1);
    expect(h.onUseDownload).toHaveBeenCalledTimes(1);
    expect(h.onReconcileByHand).toHaveBeenCalledTimes(1);
    // The person may still keep reviewing.
    expect(q("[data-statement-row='0']")).not.toBeNull();
  });

  it("says when a known bank's statements look different now", async () => {
    await render(sampleReview({ recognized_but_failed: true, activity_check: { outcome: "failed", expected: "1", found: "2" } }));
    expect(text()).toContain("This bank's statements look different from last time.");
    expect(q("[data-teach]")).not.toBeNull();
  });

  it("says plainly when nothing on the statement falls in the dates entered", async () => {
    await render(sampleReview({ rows: [], nothing_in_period: true, activity_check: { outcome: "failed", expected: "52.36", found: "43.08" } }));
    expect(text()).toContain("No transactions were found between");
    expect(text()).toContain("make sure this is the statement for Card");
    expect(q("[data-teach]")).not.toBeNull();
  });

  it("does not offer Add for lines from before an earlier reconciliation", async () => {
    await render(sampleReview({ already_reconciled_through: "2026-08-20" }));
    expect(text()).toContain(`You already reconciled this account through ${formatDisplayDate("2026-08-20")}. Lines from before then are not offered for adding.`);
    expect(q("[data-statement-row='1'] [data-add-row]")).toBeNull();
    expect(q("[data-statement-row='1']")!.getAttribute("data-choice")).toBe("none");
    expect(finishButton().disabled).toBe(true);
    await click(q("[data-statement-row='1'] [data-skip-row]"));
    expect(q("[data-statement-row='1']")!.getAttribute("data-choice")).toBe("skip");
  });

  it("skips every line from before an earlier reconciliation in one click", async () => {
    const onFinish = await render(
      sampleReview({
        already_reconciled_through: "2026-08-20",
        ending_balance: "45.08",
        rows: [
          { index: 0, date: "2026-07-24", description: "OLD ONE", amount: "-1.00", principal: null, status: "missing", match_id: null, possible_ids: [] },
          { index: 1, date: "2026-08-20", description: "OLD TWO", amount: "-1.00", principal: null, status: "missing", match_id: null, possible_ids: [] },
          { index: 2, date: "2026-08-21", description: "NEW", amount: "-2.00", principal: null, status: "missing", match_id: null, possible_ids: [] },
        ],
        app_transactions: [],
      }),
    );
    await click(q("[data-skip-earlier]"));
    expect(q("[data-statement-row='0']")!.getAttribute("data-choice")).toBe("skip");
    expect(q("[data-statement-row='1']")!.getAttribute("data-choice")).toBe("skip");
    // A line after the earlier reconciliation is still the person's to decide.
    expect(q("[data-statement-row='2']")!.getAttribute("data-choice")).toBe("none");
    await click(q("[data-statement-row='2'] [data-add-row]"));
    await click(finishButton());
    expect(lastDecisions(onFinish)).toMatchObject({ skip: [0, 1], add: [{ row: 2 }] });
  });

  it("lets the person undo a match and pick one of the possible matches", async () => {
    const review = sampleReview({
      ending_balance: "62.47",
      rows: [
        sampleReview().rows[0],
        { index: 1, date: "2026-08-17", description: "CLOUD STORAGE", amount: "-11.99", principal: null, status: "possible", match_id: null, possible_ids: [12] },
      ],
      app_transactions: [
        { id: 11, date: "2026-07-24", description: "Streaming", amount: "-7.40", change: "7.40" },
        { id: 12, date: "2026-08-16", description: "Cloud", amount: "-11.99", change: "11.99" },
      ],
    });
    const onFinish = await render(review);
    expect(q("[data-statement-row='0']")!.textContent).toContain("Matches “Streaming”");
    await click(q("[data-statement-row='0'] [data-not-a-match]"));
    expect(q("[data-statement-row='0']")!.getAttribute("data-choice")).toBe("none");
    expect(finishButton().disabled).toBe(true);
    // The old match is still offered.
    await click(q("[data-statement-row='0'] [data-same-as='11']"));
    const same = q("[data-statement-row='1'] [data-same-as='12']")!;
    expect(same.textContent).toContain("Same as “Cloud”");
    await click(same);
    expect(same.getAttribute("aria-pressed")).toBe("true");
    await click(finishButton());
    expect(lastDecisions(onFinish).matches).toEqual([
      { row: 0, transactionId: 11 },
      { row: 1, transactionId: 12 },
    ]);
  });

  it("keeps keyboard focus in the row when a choice button goes away", async () => {
    await render(sampleReview());
    const notMatch = q<HTMLButtonElement>("[data-statement-row='0'] [data-not-a-match]")!;
    notMatch.focus();
    await click(notMatch);
    // The row's first control now: the old match, offered again.
    const same = q<HTMLButtonElement>("[data-statement-row='0'] [data-same-as='11']")!;
    expect(document.activeElement).toBe(same);
    await click(same);
    expect(document.activeElement).toBe(q("[data-statement-row='0'] [data-not-a-match]"));
  });

  it("lists a transaction that is no longer matched as in the app but not on the statement", async () => {
    await render(sampleReview());
    expect(q("[data-not-on-statement]")).toBeNull();
    await click(q("[data-statement-row='0'] [data-not-a-match]"));
    // Still being decided: not listed yet.
    expect(q("[data-not-on-statement]")).toBeNull();
    await click(q("[data-statement-row='0'] [data-skip-row]"));
    expect(q("[data-not-on-statement]")!.textContent).toContain("Streaming");
    await click(q("[data-statement-row='0'] [data-same-as='11']"));
    expect(q("[data-not-on-statement]")).toBeNull();
  });

  it("skips a line, or adds it under a description the person types", async () => {
    const onFinish = await render(sampleReview({ ending_balance: "50.48" }));
    await click(q("[data-statement-row='1'] [data-skip-row]"));
    expect(q("[data-statement-row='1'] [data-add-description]")).toBeNull();
    await type(q("[data-statement-review-end]"), "50.48");
    await click(finishButton());
    expect(lastDecisions(onFinish)).toMatchObject({ add: [], skip: [1] });

    await click(q("[data-statement-row='1'] [data-add-row]"));
    await type(q("[data-statement-review-end]"), "62.47");
    const description = q<HTMLInputElement>("[data-statement-row='1'] [data-add-description]")!;
    expect(description.getAttribute("aria-label")).toContain("CLOUD STORAGE");
    await type(description, "  ");
    expect(finishButton().disabled).toBe(true);
    await type(description, " Cloud backup ");
    await click(finishButton());
    expect(lastDecisions(onFinish).add).toEqual([{ row: 1, date: "2026-08-17", description: "Cloud backup", amount: "-11.99" }]);
  });

  it("explains the part of a loan payment that pays down what you owe", async () => {
    await render(loan());
    expect(q("[data-statement-row='0']")!.textContent).toContain("$400.00 of this is the part that pays down what you owe.");
    expect(q("[data-difference]")!.getAttribute("data-balanced")).toBe("true");
  });

  it("asks before flipping, and lets the person undo a flip", async () => {
    const onFlip = vi.fn();
    await render(sampleReview({ suggest_flip: true }), { onFlip });
    expect(text()).toContain("The amounts look reversed compared with your transactions.");
    await click(q("[data-flip]"));
    expect(onFlip).toHaveBeenLastCalledWith(true);
    await render(sampleReview({ flipped: true, token: "tok-2" }), { onFlip });
    expect(text()).toContain("Amounts flipped.");
    await click(q("[data-unflip]"));
    expect(onFlip).toHaveBeenLastCalledWith(false);
  });

  it("starts over when a new review arrives", async () => {
    await render();
    await click(q("[data-statement-row='1'] [data-skip-row]"));
    expect(q("[data-statement-row='1']")!.getAttribute("data-choice")).toBe("skip");
    await render(sampleReview({ token: "tok-2" }));
    expect(q("[data-statement-row='1']")!.getAttribute("data-choice")).toBe("add");
  });

  it("lists what is in the app but not on the statement", async () => {
    await render(sampleReview({
      not_on_statement: [12],
      app_transactions: [...sampleReview().app_transactions, { id: 12, date: "2026-08-01", description: "Coffee", amount: "-3.50", change: "3.50" }],
    }));
    expect(q("[data-not-on-statement]")!.textContent).toContain("Coffee");
    expect(text()).toContain("These stay unticked. They may appear on next month's statement, or they may be duplicates.");
  });

  it("lists lines it couldn't read, which must be ignored to remember the statement", async () => {
    const onFinish = await render(sampleReview({ ending_balance: "62.47", unread: [{ line: 7, text: "08/02 ??? 4.00" }] }));
    expect(q("[data-unread]")!.textContent).toContain("08/02 ??? 4.00");
    // Remembering starts off while some lines couldn't be read, and says why.
    expect(q<HTMLInputElement>("[data-remember-toggle]")!.checked).toBe(false);
    expect(q("[data-remember-why-off]")!.textContent).toContain("some lines couldn't be read");
    expect(finishButton().disabled).toBe(false);
    await click(q("[data-remember-toggle]"));
    expect(finishButton().disabled).toBe(true);
    await click(q("[data-ignore-unread]"));
    expect(q("[data-remember-why-off]")).toBeNull();
    expect(finishButton().disabled).toBe(false);
    await click(finishButton());
    expect(lastDecisions(onFinish)).toMatchObject({ ignoreUnread: true, saveLayout: { name: "Northwind Card Services" } });
  });

  it("remembers the statement under the name and phrases the person picks, or not at all", async () => {
    const onFinish = await render(sampleReview({ ending_balance: "62.47", suggested_phrases: ["Northwind Card Services", "Account ending 1234"] }));
    expect(text()).toContain("We'll recognize statements like this next time.");
    expect(text()).toContain("Recognize it by: “Account ending 1234”");
    const phrases = document.querySelectorAll<HTMLInputElement>("[data-remember-phrase]");
    expect([...phrases].map((p) => p.checked)).toEqual([true, false]);
    await click(phrases[1]);
    await click(phrases[0]);
    await type(q("[data-remember-name]"), " Northwind ");
    await click(finishButton());
    expect(lastDecisions(onFinish).saveLayout).toEqual({ name: "Northwind", phrases: ["Account ending 1234"] });
    await click(q("[data-remember-toggle]"));
    await click(finishButton());
    expect(lastDecisions(onFinish).saveLayout).toBeNull();
  });

  it("shows the app's error as given, and holds Finish while busy", async () => {
    await render(sampleReview({ ending_balance: "62.47" }), {}, { busy: true, error: "This account changed. Read the statement again." });
    expect(q("[role='alert']")!.textContent).toBe("This account changed. Read the statement again.");
    expect(finishButton().disabled).toBe(true);
  });

  it("not now cancels", async () => {
    const onCancel = vi.fn();
    await render(sampleReview(), { onCancel });
    await click(q("[data-statement-not-now]"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("updates, adds and removes holdings for an investment statement", async () => {
    const review = investment({
      ending_value: "3172.63",
      holdings: [
        investment().holdings[0],
        { symbol: "NEWZ", name: "New", statement_shares: "2", price: "10", market_value: "20", app_holding_id: null, app_shares: null, status: "missing_in_app" },
        { symbol: "SAME", name: "Same", statement_shares: "1", price: null, market_value: "5", app_holding_id: 6, app_shares: "1", status: "same" },
      ],
      app_only_holdings: [{ id: 9, symbol: "OLDZ", name: "Old", shares: "3" }],
    });
    const onFinish = await render(review);
    expect(q("[data-difference]")).toBeNull();
    expect(q("[data-statement-review-end]")).toBeNull();
    expect(q("[data-holding='SAME']")!.textContent).toContain("Matches");
    expect(q("[data-holding='QQQZ'] [data-update-holding]")!.textContent).toBe("Update the app to 10.5 shares");
    expect(finishButton().disabled).toBe(true);
    await type(q("[data-holding='NEWZ'] [data-cost-basis]"), "18.50");
    expect(finishButton().disabled).toBe(false);
    await click(q("[data-app-only-holding='OLDZ'] [data-remove-holding]"));
    await click(finishButton());
    const d = lastDecisions(onFinish);
    expect(d).toMatchObject({ startingBalance: null, endingBalance: null, finishWithoutHoldings: false });
    expect(d.holdings).toEqual([
      { symbol: "QQQZ", action: "update", holdingId: 4, shares: "10.5", price: "300.25", costBasis: null, name: "Tracker" },
      { symbol: "NEWZ", action: "add", holdingId: null, shares: "2", price: "10", costBasis: "18.50", name: "New" },
      { symbol: "SAME", action: "leave", holdingId: 6, shares: "1", price: null, costBasis: null, name: "Same" },
      { symbol: "OLDZ", action: "remove", holdingId: 9, shares: null, price: null, costBasis: null, name: "Old" },
    ]);
  });

  it("doesn't offer removing holdings when the statement lists none", async () => {
    const onFinish = await render(investment({ holdings: [], app_only_holdings: [{ id: 9, symbol: "OLDZ", name: "Old", shares: "3" }] }));
    expect(q("[data-app-only-holding='OLDZ']")).not.toBeNull();
    expect(q("[data-remove-holding]")).toBeNull();
    expect(text()).toContain("Investments");
    await click(finishButton());
    expect(lastDecisions(onFinish).holdings.some((h) => h.action === "remove")).toBe(false);
  });

  it("treats a holding listed twice on the statement as one, with the shares added together", async () => {
    const twice = investment({
      holdings: [
        { symbol: "QQQZ", name: "Tracker", statement_shares: "10.25", price: "300.25", market_value: "3077.56", app_holding_id: 4, app_shares: "10.5", status: "different" },
        { symbol: "qqqz ", name: "Tracker", statement_shares: "0.25", price: "300.25", market_value: "75.06", app_holding_id: 4, app_shares: "10.5", status: "different" },
      ],
    });
    expect(foldHoldings(twice.holdings)).toEqual([
      { symbol: "QQQZ", name: "Tracker", statement_shares: "10.5", price: "300.25", market_value: "3152.62", app_holding_id: 4, app_shares: "10.5", status: "same" },
    ]);
    const onFinish = await render(twice);
    expect(document.querySelectorAll("[data-holding]").length).toBe(1);
    expect(q("[data-holding='QQQZ']")!.textContent).toContain("Matches");
    await click(finishButton());
    expect(lastDecisions(onFinish).holdings).toEqual([
      { symbol: "QQQZ", action: "leave", holdingId: 4, shares: "10.5", price: "300.25", costBasis: null, name: "Tracker" },
    ]);
    // Added together exactly, however many decimal places the share counts have.
    expect(
      foldHoldings([
        { ...twice.holdings[0], statement_shares: "0.123456", app_shares: "1" },
        { ...twice.holdings[1], statement_shares: "0.876544", app_shares: "1" },
      ])[0],
    ).toMatchObject({ statement_shares: "1", status: "same" });
    const missing = foldHoldings([
      { ...twice.holdings[0], app_holding_id: null, app_shares: null, status: "missing_in_app" },
      { ...twice.holdings[1], app_holding_id: null, app_shares: null, status: "missing_in_app" },
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ statement_shares: "10.5", status: "missing_in_app" });
  });

  it("an investment whose holdings couldn't be read only finishes once the person ticks the box", async () => {
    const onTeach = vi.fn();
    const onFinish = await render(investment({ holdings_check: { outcome: "failed", expected: "1", found: "2" } }), { onTeach });
    expect(text()).toContain("The app couldn't read your holdings correctly.");
    expect(q("[data-update-holding]")).toBeNull();
    await click(q("[data-teach-holdings]"));
    expect(onTeach).toHaveBeenCalled();
    expect(finishButton().disabled).toBe(true);
    await click(q("[data-finish-without-holdings]"));
    expect(finishButton().disabled).toBe(false);
    await click(finishButton());
    expect(lastDecisions(onFinish)).toMatchObject({ finishWithoutHoldings: true, holdings: [] });
  });

  it("an investment statement with no holdings total points to Investments for share counts", async () => {
    await render(investment({ holdings_check: { outcome: "not_available", expected: null, found: null } }));
    expect(text()).toContain("finish without checking holdings, then update share counts in Investments");
    expect(q("[data-update-holding]")).toBeNull();
    expect(finishButton().disabled).toBe(true);
    await click(q("[data-finish-without-holdings]"));
    expect(finishButton().disabled).toBe(false);
  });

  it("uses no jargon", async () => {
    await render(sampleReview({ unread: [{ line: 1, text: "x" }], not_on_statement: [11], suggest_flip: true }));
    expect(text()).not.toMatch(/\b(cleared|layout|parse|unmatched|tracked|published|recognise)\b/i);
    await render(investment({ holdings_check: { outcome: "failed", expected: "1", found: "2" } }));
    expect(text()).not.toMatch(/\b(cleared|layout|parse|unmatched|tracked|published|recognise|principal)\b/i);
    // A loan review explains a payment's split without the word "principal".
    await render(loan());
    expect(q("[data-pays-down]")).not.toBeNull();
    expect(text()).not.toMatch(/\b(cleared|layout|parse|unmatched|tracked|published|recognise|principal)\b/i);
  });
});
