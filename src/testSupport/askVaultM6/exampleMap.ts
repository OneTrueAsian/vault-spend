/**
 * VP-11 (Validation-Plan.md:160-168) and EX-01 to EX-06 (Requirements-Checklist.md:192-197): the frozen map from every advertised Ask the Vault
 * string to its authority, its route and its expected behavior. Test-only. Every request below is the FULL intended request, written by hand from the
 * example's meaning at the fixed date 2026-10-20 (never copied from parser output), and every figure is hand-worked from the fixture ledger in
 * `EXAMPLE_WORLD`. The independent M2 oracle is used only as a cross-check of those hand figures.
 */
import type { World } from "./referenceWorld";

export const EXAMPLE_TODAY = "2026-10-20";

/** Profile provisioned for the examples (VP-11 method step 1): every entity the examples name exists. Not edited to force a pass. */
export const EXAMPLE_WORLD: World = {
  name: "m6-example-profile", today: EXAMPLE_TODAY, members: [{ id: 1, name: "Sam" }, { id: 2, name: "Robin" }], accounts: [{ id: 1, name: "Everyday Checking", memberId: null }],
  categories: ["Dining Out", "Dining", "Groceries", "Rent"], ledger: [
    { id: 1, accountId: 1, date: "2026-07-05", description: "SUSHI PLACE", cents: -6000, category: "Dining Out", memberId: 1 },
    { id: 2, accountId: 1, date: "2026-07-12", description: "TACO TOWN", cents: -3500, category: "Dining Out", memberId: 2 },
    { id: 3, accountId: 1, date: "2026-08-01", description: "SUSHI PLACE", cents: -2000, category: "Dining Out", memberId: 1 },
    { id: 4, accountId: 1, date: "2026-09-03", description: "WHOLE FOODS MARKET #12", cents: -8000, category: "Groceries", memberId: 1 },
    { id: 5, accountId: 1, date: "2026-09-17", description: "WHOLE FOODS MARKET #12", cents: -4550, category: "Groceries", memberId: 2 },
    { id: 6, accountId: 1, date: "2026-06-10", description: "WHOLE FOODS MARKET #12", cents: -2500, category: "Groceries", memberId: 1 },
    { id: 7, accountId: 1, date: "2026-09-05", description: "COSTCO WHSE", cents: -12000, category: "Groceries", memberId: 1 },
    { id: 8, accountId: 1, date: "2026-09-20", description: "COSTCO WHSE", cents: -3000, category: "Groceries", memberId: 2 },
    { id: 9, accountId: 1, date: "2026-09-01", description: "MAPLE COURT APARTMENTS", cents: -150000, category: "Rent", memberId: null },
    { id: 10, accountId: 1, date: "2026-09-12", description: "MEIJER #55", cents: -2200, category: "Groceries", memberId: 2 },
    { id: 11, accountId: 1, date: "2026-09-14", description: "TARGET T-1204", cents: -4100, category: "Groceries", memberId: 1 },
    { id: 12, accountId: 1, date: "2026-09-25", description: "SUSHI PLACE", cents: -1800, category: "Dining Out", memberId: 1 },
    { id: 13, accountId: 1, date: "2026-10-03", description: "COSTCO WHSE", cents: -5000, category: "Groceries", memberId: 1 },
    { id: 14, accountId: 1, date: "2026-10-08", description: "TACO TOWN", cents: -2500, category: "Dining Out", memberId: 2 },
  ],
};
/** The card's parse context for that profile. */
export const EXAMPLE_PARSE_CONTEXT = {
  today: EXAMPLE_TODAY, categories: ["Dining Out", "Dining", "Groceries", "Rent"], accounts: [{ id: 1, name: "Everyday Checking" }, { id: 5, name: "Roth IRA" }],
  investmentAccounts: [{ id: 5, name: "Roth IRA" }],
  merchants: ["SUSHI PLACE", "TACO TOWN", "WHOLE FOODS MARKET #12", "COSTCO WHSE", "MAPLE COURT APARTMENTS", "MEIJER #55", "TARGET T-1204"],
  members: ["Sam", "Robin"], familyMembers: [{ id: 1, name: "Sam" }, { id: 2, name: "Robin" }], historyStart: "2025-09-01",
};

type Period = { from: string; to: string };
const SEPT: Period = { from: "2026-09-01", to: "2026-09-30" };
const YEAR_SO_FAR: Period = { from: "2026-01-01", to: EXAMPLE_TODAY };
/** Contract version 1 request with every field spelled out (M1 contract); a case overrides only what the question means. */
const v1 = (over: Record<string, unknown> & { periods: Period[] }) => ({ kind: "total", accountIds: [], categories: [], minimumPurchase: null, vendors: [], excludeVendors: [], excludeCategories: [], limit: 1, expectedRevision: null, ...over });
/** Contract version 2 request (M2 contract), every field spelled out. */
const v2 = (over: Record<string, unknown> & { periods: Period[] }) => ({ ...v1({ ...over }), contractVersion: 2, members: { ids: [], unassigned: false }, groupBy: "none", average: "none", alignment: "as-requested", ...over });

export type NativeExample = {
  id: string; text: string; source: string; route: "native";
  request: Record<string, unknown>;
  /** Fragments the card must show, each worked by hand from EXAMPLE_WORLD (see `hand`). */
  figures: string[];
  /** How the headline figure was worked, so a reader can redo it without running anything. */
  hand: string;
  /** Headline total the independent oracle must reproduce for the same request (cross-check of the hand figure). */
  oracleTotal: string;
  /** Entity the sentence names; removing it from the profile must give a plain answer, never a financial figure (VP-11 step 2). */
  absent?: { remove: "merchant" | "category" | "members"; name: string; why: string };
};
export type LegacyExample = { id: string; text: string; source: string; route: "legacy"; figures: string[]; hand: string; absentFigures: string[]; existingArithmetic: string };
export type ScenarioExample = { id: string; text: string; source: string; route: "savings-target" | "extra-money" | "spending-cut" };
export type Example = NativeExample | LegacyExample | ScenarioExample;

const L = "src/transactionQa.ts:32-45", M = "src/AskVaultCard.tsx:29", S = "src/AskVaultCard.tsx:18-23", H = "src/HelpView.tsx:1619-1620";
export const EXAMPLES: Example[] = [
  { id: "L01", text: "how much did I spend on dining out in July", source: `${L} (L01)`, route: "native", request: v1({ periods: [{ from: "2026-07-01", to: "2026-07-31" }], categories: ["Dining Out"] }),
    figures: ["You spent $95.00 on Dining Out in July 2026.", "2 purchases"], hand: "Dining Out in July: $60.00 + $35.00 = $95.00; the August $20.00 is outside July", oracleTotal: "95.00",
    absent: { remove: "category", name: "Dining Out", why: "no Dining Out category" } },
  { id: "L02", text: "how much did I spend at Whole Foods", source: `${L} (L02)`, route: "native", request: v1({ periods: [{ from: "2025-09-01", to: EXAMPLE_TODAY }], vendors: ["whole foods"] }),
    figures: ["You spent $150.50 at Whole Foods since your records begin.", "3 purchases", "Your records start on June 10, 2026"], hand: "No period: every recorded day since 2025-09-01. $80.00 + $45.50 + $25.00 = $150.50", oracleTotal: "150.50",
    absent: { remove: "merchant", name: "WHOLE FOODS MARKET #12", why: "no store called Whole Foods" } },
  { id: "L03", text: "what's my runway if rent goes up by $200", source: `${L} (L03)`, route: "legacy", figures: ["6.0 months", "5.0 months"], hand: "cash $6,000 / $1,000 a month = 6.0; $6,000 / $1,200 = 5.0", absentFigures: ["I don't have enough spending history yet to estimate a runway."], existingArithmetic: "src/transactionQa.test.ts runway what-if" },
  { id: "L04", text: "how much do I have in checking", source: `${L} (L04)`, route: "legacy", figures: ["You have $6,000.00 in checking."], hand: "one checking account at $6,000.00", absentFigures: ["You have $0.00 in checking."], existingArithmetic: "src/transactionQa.test.ts balance lookups" },
  { id: "L05", text: "what's my net worth", source: `${L} (L05)`, route: "legacy", figures: ["Your net worth is $22,500.00."], hand: "6,000 checking + 25,000 investment - 8,500 owed on the loan", absentFigures: ["Your net worth is $0.00."], existingArithmetic: "src/transactionQa.test.ts net worth and debt" },
  { id: "L06", text: "what's my total debt", source: `${L} (L06)`, route: "legacy", figures: ["You owe $8,500.00 in total."], hand: "one loan owing $8,500.00", absentFigures: ["You have no debt in Vault Spend — nice."], existingArithmetic: "src/transactionQa.test.ts net worth and debt" },
  { id: "L07", text: "how much do I owe on car loan", source: `${L} (L07)`, route: "legacy", figures: ["You owe $8,500.00 on Car Loan."], hand: "Car Loan current balance $8,500.00", absentFigures: ["I couldn't find a debt account matching \"car loan\"."], existingArithmetic: "src/transactionQa.test.ts net worth and debt" },
  { id: "L08", text: "how much are my subscriptions", source: `${L} (L08)`, route: "legacy", figures: ["Your recurring bills add up to about $60.00/mo, across 2 recurring bills."], hand: "Netflix $15.00 + Gym $45.00, both monthly", absentFigures: ["No recurring bills set up yet."], existingArithmetic: "src/transactionQa.test.ts subscriptions and bills" },
  { id: "L09", text: "when is my next bill due", source: `${L} (L09)`, route: "legacy", figures: ["Your next bill is Netflix for -$15.00 on Oct 25."], hand: "Netflix is due 2026-10-25, before Gym on 2026-11-02", absentFigures: ["No recurring bills set up yet."], existingArithmetic: "src/transactionQa.test.ts subscriptions and bills" },
  { id: "L10", text: "how much have I saved toward vacation", source: `${L} (L10)`, route: "legacy", figures: ["Vacation Fund has $1,500.00 saved of its $3,000.00 target (50%)."], hand: "1,500 / 3,000 = 50%", absentFigures: ["I couldn't find a goal matching \"vacation\"."], existingArithmetic: "src/transactionQa.test.ts bucket progress" },
  { id: "L11", text: "what's my savings rate this month", source: `${L} (L11)`, route: "legacy", figures: ["Your savings rate for this month is 67% ($3,000.00 income, $1,000.00 spent)."], hand: "(3,000 - 1,000) / 3,000 = 66.7%, shown as 67%", absentFigures: ["No income found for this month, so a savings rate isn't meaningful yet."], existingArithmetic: "src/transactionQa.test.ts savings rate" },
  { id: "L12", text: "compare this month to last month", source: `${L} (L12)`, route: "native", request: v1({ kind: "compare", periods: [{ from: "2026-10-01", to: EXAMPLE_TODAY }, SEPT] }),
    figures: ["You spent $75.00 in October 2026 so far and $1,856.50 in September 2026.", "That is $1,781.50 less in October 2026 so far.", "this is not a like-for-like comparison. Only the dollar difference is shown."],
    hand: "October 1-20: 50.00 + 25.00 = 75.00. September: 338.50 groceries + 18.00 dining + 1,500.00 rent = 1,856.50. Difference 1,781.50; 20 days against 30 days so no percentage", oracleTotal: "75.00" },
  { id: "M01", text: "how much did I spend at Costco last month", source: `${M} (MORE_EXAMPLES[0])`, route: "native", request: v1({ periods: [SEPT], vendors: ["costco"] }),
    figures: ["You spent $150.00 at Costco in September 2026.", "2 purchases"], hand: "$120.00 + $30.00 in September", oracleTotal: "150.00", absent: { remove: "merchant", name: "COSTCO WHSE", why: "no store called Costco" } },
  { id: "M02", text: "everything except rent last month", source: `${M} (MORE_EXAMPLES[1])`, route: "native", request: v1({ periods: [SEPT], excludeCategories: ["Rent"] }),
    figures: ["You spent $356.50 on everything, excluding Rent, in September 2026.", "7 purchases", "Left out as you asked: Rent ($1,500.00)."], hand: "1,856.50 - 1,500.00 = 356.50 over 8 - 1 = 7 purchases", oracleTotal: "356.50",
    absent: { remove: "category", name: "Rent", why: "no Rent category" } },
  { id: "M03", text: "spending by month this year", source: `${M} (MORE_EXAMPLES[2])`, route: "native", request: v2({ periods: [YEAR_SO_FAR], groupBy: "month" }),
    figures: ["You spent $2,071.50 on everything in 2026 so far.", "14 purchases", "January 2026$0.000 purchases · Before recording began; spending unknown", "Show all 10"],
    hand: "June 25.00 + July 95.00 + August 20.00 + September 1,856.50 + October 75.00 = 2,071.50 over 14 purchases", oracleTotal: "2071.50" },
  { id: "M04", text: "average purchase on groceries last month", source: `${M} (MORE_EXAMPLES[3])`, route: "native", request: v2({ periods: [SEPT], categories: ["Groceries"], average: "per-purchase" }),
    figures: ["You averaged $56.42 per purchase on Groceries in September 2026.", "$338.50 ÷ 6 purchases"], hand: "338.50 / 6 = 56.4166..., rounded half up to 56.42", oracleTotal: "338.50",
    absent: { remove: "category", name: "Groceries", why: "no Groceries category" } },
  { id: "M05", text: "what did each family member spend last month", source: `${M} (MORE_EXAMPLES[4])`, route: "native", request: v2({ periods: [SEPT], groupBy: "member" }),
    figures: ["You spent $1,856.50 on everything in September 2026.", "Not assigned to anyone$1,500.00", "Sam$259.00", "Robin$97.50"], hand: "Sam 120.00 + 80.00 + 41.00 + 18.00 = 259.00; Robin 45.50 + 30.00 + 22.00 = 97.50; unassigned rent 1,500.00", oracleTotal: "1856.50" },
  { id: "M06", text: "Where can I cut back to save $200 a month?", source: `${M} (MORE_EXAMPLES[5])`, route: "savings-target" },
  { id: "M07", text: "Save $200 in total this year", source: `${M} (MORE_EXAMPLES[6])`, route: "savings-target" },
  { id: "M08", text: "Extra $50 a month into Roth IRA until January 2056", source: `${M} (MORE_EXAMPLES[7])`, route: "extra-money" },
  { id: "M09", text: "What if I cut Groceries by $50 a month?", source: `${M} (MORE_EXAMPLES[8])`, route: "spending-cut" },
  { id: "S01", text: "how much did I spend on groceries last month", source: `${S} (SUGGESTIONS[0])`, route: "native", request: v1({ periods: [SEPT], categories: ["Groceries"] }),
    figures: ["You spent $338.50 on Groceries in September 2026.", "6 purchases"], hand: "80.00 + 45.50 + 120.00 + 30.00 + 22.00 + 41.00 = 338.50", oracleTotal: "338.50", absent: { remove: "category", name: "Groceries", why: "no Groceries category" } },
  { id: "S02", text: "top 3 spending categories this year", source: `${S} (SUGGESTIONS[1])`, route: "native", request: v1({ kind: "rank-categories", periods: [YEAR_SO_FAR], limit: 3 }),
    figures: ["Rent$1,500.001 purchase", "Groceries$413.508 purchases", "Dining Out$158.005 purchases"], hand: "Rent 1,500.00; Groceries 25.00 + 80.00 + 45.50 + 120.00 + 30.00 + 22.00 + 41.00 + 50.00 = 413.50; Dining Out 60.00 + 35.00 + 20.00 + 18.00 + 25.00 = 158.00", oracleTotal: "2071.50" },
  { id: "S03", text: "my three biggest expenses last month", source: `${S} (SUGGESTIONS[2])`, route: "native", request: v1({ kind: "rank-purchases", periods: [SEPT], limit: 3 }),
    figures: ["MAPLE COURT APARTMENTS$1,500.00September 1, 2026", "COSTCO WHSE$120.00September 5, 2026", "WHOLE FOODS MARKET #12$80.00September 3, 2026"], hand: "September purchases ranked by amount: rent 1,500.00, Costco 120.00, Whole Foods 80.00", oracleTotal: "1856.50" },
  { id: "S04", text: "groceries last month without Costco", source: `${S} (SUGGESTIONS[3])`, route: "native", request: v1({ periods: [SEPT], categories: ["Groceries"], excludeVendors: ["costco"] }),
    figures: ["$188.50", "4 purchases"], hand: "338.50 - Costco 150.00 = 188.50 over 6 - 2 = 4 purchases", oracleTotal: "188.50", absent: { remove: "merchant", name: "COSTCO WHSE", why: "no store called Costco" } },
  { id: "H01", text: "how much did I spend at Meijer and Target last month", source: `${H} (Help only)`, route: "native", request: v1({ periods: [SEPT], vendors: ["meijer", "target"] }),
    figures: ["$63.00", "2 purchases"], hand: "Meijer 22.00 + Target 41.00", oracleTotal: "63.00", absent: { remove: "merchant", name: "MEIJER #55", why: "no store called Meijer" } },
];

/** Legacy profile (answered by the real `answerTransactionQuestion`). Plain numbers; the hand arithmetic is in each LegacyExample.hand. */
export const LEGACY_PROFILE = {
  today: [2026, 9, 20] as const, avgMonthlySpend: "1000",
  accounts: [
    { id: 1, name: "Everyday Checking", account_type: "checking", starting_balance: "0", current_balance: "6000" },
    { id: 2, name: "Car Loan", account_type: "loan", starting_balance: "20000", current_balance: "8500" },
    { id: 3, name: "Roth IRA", account_type: "investment", starting_balance: "0", current_balance: "25000" },
  ],
  buckets: [{ id: 1, name: "Vacation Fund", target_amount: "3000.00", saved_amount: "1500.00" }],
  recurring: [{ id: 1, merchant: "Netflix", amount: "-15.00", next_date: "2026-10-25" }, { id: 2, merchant: "Gym", amount: "-45.00", next_date: "2026-11-02" }],
  transactions: [
    { date: "2026-10-01", description: "Paycheck", amount: "3000.00", category: "Income" },
    { date: "2026-10-05", description: "Grocer", amount: "-600.00", category: "Groceries" },
    { date: "2026-10-06", description: "Landlord", amount: "-400.00", category: "Rent" },
  ],
};
