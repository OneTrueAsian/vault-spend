import { describe, expect, it } from "vitest";
import { parseRetirementScenario } from "./retirementParser";
import { parseCutPreview } from "./cutPreviewParser";
import { parseSpendingScenario } from "./spendingScenarioParser";
import { parseQuestion } from "./parser";
import type { ParseContext } from "./types";

/**
 * M6 step 3. Parser-level behavior for the owner's decisions D-S3-01 (a leading "Save ..." into an investment account),
 * D-S3-02 (one-category saving wording through the spending-reduction preview) and the two confirmed source findings
 * SR-02 (a quoted name is not an operator) and SR-04 (an investment account is claimed by its whole name).
 * Each block states the behavior; the card-level rows that prove routing live in AskVaultCardRouting.test.tsx.
 */

describe("SR-01: a leading save phrase into an investment account asks whether the money is extra", () => {
  const ctx = { today: "2026-10-20", investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "Brokerage" }] };
  const clarification = (text: string) => {
    const got = parseRetirementScenario(text, ctx);
    expect(got?.kind, text).toBe("retirement-clarify");
    if (got?.kind !== "retirement-clarify") throw Error("expected a clarification for: " + text);
    return got.clarification;
  };
  const tail = " a month into my Roth IRA until June 2050";
  it.each([
    ["Save $50", "Extra $50"],
    ["save $50", "Extra $50"],
    ["SAVE $50", "Extra $50"],
    ["Please save $50", "Extra $50"],
    ["I want to save $50", "Extra $50"],
    ["We want to save $50", "Extra $50"],
    ["Help me save $50", "Extra $50"],
    ["Can you help me save $50", "Extra $50"],
    ["How can I save $50", "Extra $50"],
    ["How could we save $50", "Extra $50"],
    ["Where can I save $50", "Extra $50"],
  ])("asks the owner's question for %s and offers the same question with only the lead-in replaced", (lead, extra) => {
    expect(clarification(lead + tail)).toEqual({
      status: "clarify", reason: "Do you mean adding an extra $50 a month to this account?",
      choices: ["Yes, add an extra $50 a month"], replacements: [extra + tail],
    });
  });
  it("keeps a trailing question mark and every later word byte for byte", () => {
    expect(clarification("How can I save $50 a month into my Roth IRA until June 2050?").replacements).toEqual(["Extra $50 a month into my Roth IRA until June 2050?"]);
  });
  it("says the amount as typed, with grouping", () => {
    expect(clarification("Save $1,000 a month into my Roth IRA until June 2050").reason).toBe("Do you mean adding an extra $1,000 a month to this account?");
  });
  it("says one time for a one-time amount", () => {
    const got = clarification("Save $500 one time into my Roth IRA until June 2050");
    expect(got.reason).toBe("Do you mean adding an extra $500 one time to this account?");
    expect(got.choices).toEqual(["Yes, add an extra $500 one time"]);
  });
  it("leaves the cadence out of the sentence when none was given, and the answer then asks for it", () => {
    const got = clarification("Save $50 into my Roth IRA until June 2050");
    expect(got.reason).toBe("Do you mean adding an extra $50 to this account?");
    const next = parseRetirementScenario(got.replacements![0], ctx);
    expect(next).toMatchObject({ kind: "retirement", draft: { accountId: 5, extra: { kind: null, amount: "50" }, retirementMonth: "2050-06", missing: ["cadence"] } });
  });
  it("preserves account, amount, cadence and retirement month, so the affirmative answer is the explicit extra question", () => {
    const got = clarification("Save $50 a month into my Roth IRA until June 2050");
    const next = parseRetirementScenario(got.replacements![0], ctx);
    expect(next).toMatchObject({ kind: "retirement", draft: { accountId: 5, extra: { kind: "monthly", amount: "50" }, retirementMonth: "2050-06", missing: [] } });
    const direct = parseRetirementScenario("Extra $50 a month into my Roth IRA until June 2050", ctx);
    expect(next).toEqual(direct && direct.kind === "retirement" ? { ...direct, draft: { ...direct.draft, sourceText: got.replacements![0] } } : direct);
  });
  it("preserves a typed future start through the question", () => {
    const got = clarification("Save $50 a month into my Roth IRA starting next month until June 2050");
    const next = parseRetirementScenario(got.replacements![0], ctx);
    expect(next).toMatchObject({ kind: "retirement", draft: { accountId: 5, startDate: null, retirementMonth: "2050-06", missing: ["start-date"] } });
  });
  it("preserves the choice of which year when the year is missing", () => {
    const got = clarification("Save $50 a month into my Roth IRA until June");
    expect(got.replacements).toEqual(["Extra $50 a month into my Roth IRA until June"]);
    expect(parseRetirementScenario(got.replacements![0], ctx)).toMatchObject({ kind: "retirement-clarify", clarification: { reason: "Which year?" } });
  });
  it("asks about the named account when a different account is named", () => {
    const got = clarification("Save $50 a month into my Brokerage until June 2050");
    expect(parseRetirementScenario(got.replacements![0], ctx)).toMatchObject({ kind: "retirement", draft: { accountId: 6 } });
  });
  it.each([
    "Save an extra $50 a month into my Roth IRA until June 2050",
    "Save an additional $50 a month into my Roth IRA until June 2050",
    "Help me save an extra $50 a month into my Roth IRA until June 2050",
    "Please save an additional $50 a month into my Roth IRA until June 2050",
    "I want to save $50 extra a month into my Roth IRA until June 2050",
    "How can I save an extra $50 a month into my Roth IRA until June 2050?",
  ])("goes straight to the extra-money request when the money is stated to be extra or additional: %s", text => {
    const got = parseRetirementScenario(text, ctx);
    expect(got).toMatchObject({ kind: "retirement", draft: { sourceText: text, accountId: 5, extra: { kind: "monthly", amount: "50" }, retirementMonth: "2050-06", missing: [] } });
  });
  it.each([
    "Save $50 a month into my Roth IRA instead of $100 until June 2050",
    "Save $50 a month into my Roth IRA instead of $100",
    "Save only $50 a month into my Roth IRA until June 2050",
    "Save just $50 a month into my Roth IRA until June 2050",
    "Save $50 a month into my Roth IRA rather than $100 until June 2050",
    "Save $50 a month into my Roth IRA instead",
    "Save $50 a month and change my Roth IRA contribution until June 2050",
    "Please save $50 a month, switching my Roth IRA from $100, until June 2050",
    "Help me save $50 a month into my Roth IRA and lower it to $25 until June 2050",
  ])("does not mistake a replacement for an addition, and says so in plain words: %s", text => {
    expect(parseRetirementScenario(text, ctx)).toEqual({ kind: "retirement-unsupported", reason: "I couldn't keep every part of that request. Ask about one extra monthly or one-time amount in one investment account, with a retirement month." });
  });
  it.each([
    "Save $50 a month into my Roth IRA, not $100, until June 2050",
    "Save $50 a month into my Roth IRA and my Brokerage until June 2050",
  ])("refuses any other leftover words instead of asking about extra money: %s", text => {
    expect(parseRetirementScenario(text, ctx)?.kind).toBe("retirement-unsupported");
  });
  it("refuses what the extra-money request would refuse, instead of asking first", () => {
    expect(parseRetirementScenario("Save $50 a month into my Roth IRA until June 1999", ctx)?.kind).toBe("retirement-unsupported");
    expect(parseRetirementScenario("Save $50.123 a month into my Roth IRA until June 2050", ctx)?.kind).toBe("retirement-unsupported");
    expect(parseRetirementScenario("Save $50 a month into my Roth IRA until June 2050 only if I get a raise", ctx)?.kind).toBe("retirement-unsupported");
  });
  it("does not ask about a question that does not start with a save phrase", () => {
    expect(parseRetirementScenario("put $50 a month into my Roth IRA until June 2050", ctx)?.kind).toBe("retirement");
    expect(parseRetirementScenario("Add $50 a month to my Roth IRA until June 2050", ctx)?.kind).toBe("retirement");
  });
  it("never mutates the context it is given", () => {
    const copy = structuredClone(ctx);
    parseRetirementScenario("Save $50 a month into my Roth IRA until June 2050", ctx);
    expect(ctx).toEqual(copy);
  });
});

describe("SR-01: instructions that mix a spending category with an investment account clarify, they never pick one", () => {
  const ctx = { today: "2026-10-20", investmentAccounts: [{ id: 5, name: "Roth IRA" }], categories: ["Dining", "Groceries", "Roth"] };
  const MIXED = "That mixes spending in a category with adding money to an investment account. Ask about one at a time.";
  it.each([
    "Save $50 on Dining and $50 a month into my Roth IRA until June 2050",
    "Cut Dining by $50 and put $50 a month into my Roth IRA until June 2050",
    "Put $50 a month into my Roth IRA and cut Groceries by $20",
    "Extra $50 a month into my Roth IRA until June 2050 and Dining too",
    "Please save $50 on Groceries and add $50 a month to my Roth IRA until June 2050",
  ])("asks which one is meant and offers no silent choice: %s", text => {
    expect(parseRetirementScenario(text, ctx)).toEqual({ kind: "retirement-clarify", clarification: { status: "clarify", reason: MIXED, choices: [], replacements: [] } });
  });
  it("is unchanged when no recorded category is named, or when the category words are part of the account name", () => {
    expect(parseRetirementScenario("Extra $50 a month into my Roth IRA until June 2050", ctx)?.kind).toBe("retirement");
    expect(parseRetirementScenario("Save $50 a month into my Roth IRA until June 2050", ctx)).toMatchObject({ kind: "retirement-clarify", clarification: { reason: expect.stringContaining("extra") } });
  });
  it("leaves refusals alone when the app gave no category list", () => {
    const { categories: _unused, ...plain } = ctx;
    expect(parseRetirementScenario("Cut Dining by $50 and put $50 a month into my Roth IRA until June 2050", plain)?.kind).toBe("retirement-unsupported");
  });
  it("does not turn a good question into a mixed one", () => {
    expect(parseRetirementScenario("Extra $50 a month into my Roth IRA until June 2050", { ...ctx, categories: ["Roth IRA", "Dining"] })?.kind).toBe("retirement");
  });
});

describe("SR-04: an investment account is claimed by its whole name, never by letters inside another word", () => {
  const ctx = { today: "2026-10-20", investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "ETF" }, { id: 7, name: "IRA" }] };
  it.each([
    "how much have I saved on Netflix",
    "how much have I saved on spirals",
    "how much did I save at the Retiree Fund",
    "how much have I saved on Netflix last month",
  ])("leaves a question about another word to the other readers: %s", text => {
    expect(parseRetirementScenario(text, ctx)).toBeNull();
  });
  it.each([
    ["Extra $50 a month into ETF until June 2050", 6],
    ["put $50 a month into etf until June 2050", 6],
    ["put $50 a month into the ETF, until June 2050", 6],
    ["Extra $50 a month into IRA until June 2050", 7],
  ])("still claims a question that names the account as a whole word: %s", (text, id) => {
    expect(parseRetirementScenario(text, ctx)).toMatchObject({ kind: "retirement", draft: { accountId: id } });
  });
  it("finds a name written with different spacing and case as before", () => {
    expect(parseRetirementScenario("put $50 a month into roth   ira until June 2050", ctx)).toMatchObject({ kind: "retirement", draft: { accountId: 5 } });
  });
});

describe("D-S3-01: the savings-target reader hands a question that names an investment account to the extra-money reader", () => {
  const ctx: ParseContext = { today: "2026-10-20", categories: ["Dining", "Groceries", "Rent"], accounts: [], investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "ETF" }] };
  it.each([
    "Save $50 a month into my Roth IRA until June 2050",
    "Please save $50 a month into my Roth IRA until June 2050",
    "I want to save $50 a month into my Roth IRA until June 2050",
    "Help me save $50 a month into my Roth IRA until June 2050",
    "Can you help me save $50 a month into my Roth IRA until June 2050",
    "How can I save $50 a month into my Roth IRA until June 2050?",
    "How could we save $50 a month into my Roth IRA until June 2050",
    "Where can I save $50 a month into my Roth IRA until June 2050",
    "Save an extra $50 a month into my Roth IRA until June 2050",
    "Save $50 a month in my ETF until June 2050",
  ])("is not claimed: %s", text => {
    expect(parseCutPreview(text, ctx)).toBeNull();
  });
  it("still claims it when the app has no investment account list, exactly as before", () => {
    const { investmentAccounts: _unused, ...plain } = ctx;
    expect(parseCutPreview("Save $50 a month into my Roth IRA until June 2050", plain)?.kind).toBe("cut-preview-unsupported");
    expect(parseCutPreview("Save $50 a month into my Roth IRA until June 2050", { ...ctx, investmentAccounts: [] })?.kind).toBe("cut-preview-unsupported");
  });
  it("still claims a savings target that names no investment account", () => {
    for (const text of ["Where can I cut back to save $200 a month?", "Save $200 in total this year", "Save $200 monthly across Dining and Groceries from November through December 2026"])
      expect(parseCutPreview(text, ctx)?.kind, text).toBe("cut-preview");
  });
  it("does not hand off a name that only occurs inside another word", () => {
    expect(parseCutPreview("Save $200 monthly across Dining and Netflix from November through December 2026", ctx)?.kind).toBe("cut-preview-clarify");
    expect(parseCutPreview("Save $200 monthly across Dining from November through December 2026", ctx)?.kind).toBe("cut-preview");
  });
  it("keeps a cut-back phrase with an account name as a savings-target refusal, which selects nothing", () => {
    expect(parseCutPreview("Where can I cut back to save $50 a month into my Roth IRA until June 2050", ctx)?.kind).toBe("cut-preview-unsupported");
  });
});

describe("D-S3-02 / SR-03: one-category saving wording becomes the spending-reduction preview", () => {
  const ctx: ParseContext = { today: "2026-10-20", categories: ["Dining", "Groceries", "Rent"], accounts: [{ id: 1, name: "Everyday Checking" }], investmentAccounts: [{ id: 5, name: "Roth IRA" }] };
  const scenario = (text: string, context = ctx) => {
    const got = parseSpendingScenario(text, context);
    expect(got?.kind, text).toBe("scenario");
    if (got?.kind !== "scenario") throw Error(JSON.stringify(got));
    return got.draft;
  };
  const leads = ["Help me save", "How can I save", "How can we save", "Please save", "I want to save", "We want to save", "Can you help me save", "Where can I save", "Please help me save", "How could I save"];
  it.each(leads)("%s ... on Dining each month keeps the category, the amount and the cadence", lead => {
    const text = `${lead} $50 on Dining each month`;
    expect(scenario(text)).toMatchObject({ sourceText: text, category: "Dining", reduction: { kind: "money", amount: "50" }, cadence: "monthly", horizon: null, partialMonth: null, missing: ["horizon", "partial-month"] });
  });
  it.each(leads)("%s ... on Dining keeps every date clause", lead => {
    expect(scenario(`${lead} $50 on Dining each month from November through December 2026`)).toMatchObject({
      category: "Dining", reduction: { kind: "money", amount: "50" }, cadence: "monthly",
      horizon: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, partialMonth: "exclude", missing: [],
    });
  });
  it("keeps a one-time amount and its date", () => {
    expect(scenario("I want to save $50 on Dining once on 2026-11-15")).toMatchObject({ category: "Dining", reduction: { kind: "money", amount: "50" }, cadence: "once", horizon: { from: "2026-11-15", to: "2026-11-15" }, partialMonth: "none", missing: [] });
  });
  it("keeps a percentage and a part-month choice", () => {
    expect(scenario("Please save 10% on Groceries each month from 2026-11-01 to 2026-12-31 prorated")).toMatchObject({ category: "Groceries", reduction: { kind: "percent", amount: "10" }, cadence: "monthly", partialMonth: "prorate" });
  });
  it("keeps grouped amounts and trailing question marks", () => {
    expect(scenario("How can I save $1,000.50 on Rent each month?")).toMatchObject({ category: "Rent", reduction: { kind: "money", amount: "1000.50" } });
  });
  it("leaves the unresolved date as a choice and keeps a month hint", () => {
    expect(scenario("Help me save $50 on Dining each month in November")).toMatchObject({ category: "Dining", horizon: null, scheduleHints: [expect.objectContaining({ kind: "month", month: 11 })] });
  });
  it.each([
    ["Help me save $50 on Dining at Costco each month", /at Costco/],
    ["Please save $50 on Dining for Alex each month", /alex/i],
    ["I want to save $50 on Dining without Costco each month", /invest|apply|conditions/],
    ["Help me save $50 on Dining and invest it each month", /invest/],
    ["Please save $50 on Dining and put it in my Roth IRA each month", /condition/],
    ["How can I save $50 on Dining weekly", /Weekly|daily/i],
    ["Help me save $50 on Dining last month", /Retrospective/],
    ["Please save $50 on the Dining budget each month", /budget/i],
    ["I want to save $50 on Dining and Groceries each month", /one unambiguous category/],
  ])("keeps the refusal that Cut would give, so no clause is dropped: %s", (text, reason) => {
    expect(parseSpendingScenario(text, ctx)).toMatchObject({ kind: "scenario-unsupported", reason: expect.stringMatching(reason) });
  });
  it("names an unknown category as a clarification with close choices only", () => {
    expect(parseSpendingScenario("Help me save $50 on Dinning each month from November through December 2026", ctx)).toMatchObject({ kind: "scenario-clarify", clarification: { choices: ["Dining"] } });
    expect(parseSpendingScenario("Help me save $50 on zzzzqq each month", ctx)).toMatchObject({ kind: "scenario-clarify", clarification: { choices: [] } });
  });
  it("does not claim other questions that merely begin the same way", () => {
    for (const text of ["Help me with my budget", "How can I save", "Please show my spending on Dining", "I want to know my spending on Dining", "How can I save money on Dining"])
      expect(parseSpendingScenario(text, ctx), text).toBeNull();
  });
  it.each([
    "Help me save $50 on Dinning each month from November through December 2026",
    "Please save $50 on dinning each month",
    "Save $50 on Dinning each month",
    "Please save 10% in Grocries each month",
  ])("hands a single misspelled category to the spending-cut reader, which offers the close names: %s", text => {
    expect(parseCutPreview(text, ctx), text).toBeNull();
    expect(parseSpendingScenario(text, ctx)?.kind, text).toBe("scenario-clarify");
  });
  it("the choice re-asks the whole question with the exact category and keeps every clause", () => {
    const text = "Help me save $50 on Dinning each month from November through December 2026";
    const got = parseSpendingScenario(text, ctx);
    if (got?.kind !== "scenario-clarify") throw Error("expected a clarification");
    expect(got.clarification.replacements).toEqual(['Help me save $50 on "Dining" each month from November through December 2026']);
    expect(parseCutPreview(got.clarification.replacements![0], ctx)).toBeNull();
    expect(parseSpendingScenario(got.clarification.replacements![0], ctx)).toMatchObject({ kind: "scenario", draft: { category: "Dining", reduction: { amount: "50" }, cadence: "monthly", horizon: { from: "2026-11-01", to: "2026-12-31" } } });
  });
  it.each([
    "Save $50 on zzzzqq each month",
    "Save $200 monthly in 2027",
    "Save $200 in total this year",
    "Save $200 monthly in November",
    "Where can I cut back to save $200 a month?",
  ])("leaves everything else with the savings-target reader exactly as before: %s", text => {
    expect(parseCutPreview(text, ctx), text).not.toBeNull();
  });
  it("is read by the savings-target reader only as a pass-through, never as a target", () => {
    for (const lead of leads) expect(parseCutPreview(`${lead} $50 on Dining each month`, ctx), lead).toBeNull();
  });
  it("shows that editing the amount changes the draft", () => {
    expect(scenario("Help me save $50 on Dining each month").reduction).toEqual({ kind: "money", amount: "50" });
    expect(scenario("Help me save $75 on Dining each month").reduction).toEqual({ kind: "money", amount: "75" });
  });
});

describe("SR-02: a quoted name is not an operator, and a factual question is not a scenario", () => {
  const ctx: ParseContext = { today: "2026-10-20", categories: ["Dining", "Groceries"], accounts: [], merchants: ["Costco"] };
  it.each([
    'how much did I spend at "Cut Above" last month',
    'how much did I spend at "Cut Above" in July',
    'how much did I spend at "Reduce Fare" last month',
    'spending at "Cut Above" by month',
    'what did I spend at "What If Cafe" last month',
    'how much did I spend at "Save A Lot" last month',
  ])("leaves a quoted store name to the ordinary reader: %s", text => {
    expect(parseSpendingScenario(text, ctx)).toBeNull();
  });
  it.each([
    "how much did I spend at Cut Above in July",
    "how much have I spent at Reduce Fare last month",
    "what did I spend at Cut Above",
    "How much did I spend on Dining at Cut Above last month",
  ])("leaves a plain past-tense spending question to the ordinary reader: %s", text => {
    expect(parseSpendingScenario(text, ctx)).toBeNull();
  });
  it.each([
    "What if I cut Dining by $50",
    'Cut "Dining" by $50',
    "Cut Dining by $50 monthly from November to December 2026",
    "How much would I save if I cut Dining by $50 a month",
    "What if I spend $50 less on Dining each month",
    "If I cut Dining by $50 a month from November through December 2026, how much would I save",
  ])("still reads a real scenario: %s", text => {
    expect(parseSpendingScenario(text, ctx)?.kind).not.toBeNull();
    expect(parseSpendingScenario(text, ctx)?.kind).toMatch(/^scenario/);
  });
  it("keeps the retrospective refusal for a past-tense scenario", () => {
    expect(parseSpendingScenario("How much would I have saved if I cut Dining by $50 last month", ctx)).toMatchObject({ kind: "scenario-unsupported", reason: expect.stringMatching(/Retrospective/) });
    expect(parseSpendingScenario("What would I have saved last year?", ctx)).toMatchObject({ kind: "scenario-unsupported" });
  });
  it("still sees a scenario word outside the quotes when a quoted store is also present", () => {
    expect(parseSpendingScenario('What if I cut Dining by $50 at "Cut Above"', ctx)).toMatchObject({ kind: "scenario-unsupported", reason: expect.stringMatching(/scope|condition/) });
  });
});

describe("M6 review fixes: accounts named with an extra word, and misspelled categories with every month / once", () => {
  const acct = { today: "2026-10-20", categories: ["Dining", "Groceries", "Rent"], accounts: [], investmentAccounts: [{ id: 8, name: "Extra Retirement" }, { id: 9, name: "Additional Savings" }, { id: 5, name: "Roth IRA" }] };
  it.each([
    "Save $50 a month into Extra Retirement until June 2050",
    "Save $50 a month into my Additional Savings until June 2050",
    "Save $50 a month into \"Extra Retirement\" until June 2050",
  ])("still asks whether %s means extra money", text => {
    const out = parseRetirementScenario(text, acct);
    expect(out).toMatchObject({ kind: "retirement-clarify" });
    expect((out as { clarification: { reason: string } }).clarification.reason).toMatch(/Do you mean adding an extra \$50 a month/);
  });
  it("goes straight to the review when the money is stated to be extra, even with such an account name", () => {
    expect(parseRetirementScenario("Save an extra $50 a month into Extra Retirement until June 2050", acct)?.kind).toBe("retirement");
  });
  it.each([
    "Help me save $50 on Dinning every month from November through December 2026",
    "Help me save $50 on Dinning once on November 5, 2026",
    "Help me save $50 on Dinning once",
    "Save $50 on Dinning every month",
  ])("hands a misspelled single category to the spending preview's clarification: %s", text => {
    expect(parseCutPreview(text, acct as ParseContext)).toBeNull();
    expect(parseSpendingScenario(text, acct as ParseContext)).toMatchObject({ kind: "scenario-clarify", clarification: { choices: ["Dining"] } });
  });
});

describe("D-S4-01 (I-01): extra money for retirement with no named account goes to the extra-money flow", () => {
  const withAccount = { today: "2026-10-20", categories: ["Dining", "Groceries"], accounts: [], investmentAccounts: [{ id: 5, name: "Roth IRA" }] } as ParseContext;
  const none = { ...withAccount, investmentAccounts: [] } as ParseContext;
  it.each([
    "Save an extra $50 a month for retirement",
    "Save an additional $50 a month for retirement",
    "Save an extra $50 a month for retirement until June 2050",
    "Please save an extra $50 a month for my retirement",
  ])("is left to the extra-money reader by the savings-target reader: %s", text => {
    expect(parseCutPreview(text, withAccount)).toBeNull();
    const out = parseRetirementScenario(text, withAccount as never);
    expect(out).toMatchObject({ kind: "retirement", draft: { accountId: null, extra: { kind: "monthly", amount: "50" } } });
  });
  it("asks for the account and the month, never choosing an account", () => {
    const out = parseRetirementScenario("Save an extra $50 a month for retirement", withAccount as never) as { draft: { accountId: number | null; missing: string[] } };
    expect(out.draft.accountId).toBeNull(); expect(out.draft.missing).toEqual(expect.arrayContaining(["account", "retirement-month"]));
  });
  it("explains that an investment account is required when none exists", () => {
    expect(parseRetirementScenario("Save an extra $50 a month for retirement", none as never)).toMatchObject({ kind: "retirement-unsupported", reason: expect.stringMatching(/investment account/i) });
  });
  it("keeps the other readers unchanged: a plain target, an extra cut in a category, and no marker at all", () => {
    expect(parseCutPreview("Save $200 a month across Dining and Groceries from November through December 2026", withAccount)?.kind).not.toBe("cut-preview-unsupported");
    expect(parseCutPreview("Save an extra $50 a month for Dining", withAccount)).not.toBeNull();
    expect(parseCutPreview("Save $50 a month for retirement", withAccount)).not.toBeNull();
  });
});

describe("D-S4-02 (I-02 / I-03): a known store name is not an instruction", () => {
  const stores = { today: "2026-10-20", categories: ["Dining", "Groceries"], accounts: [], merchants: ["Save A Lot", "Extra Space Storage", "Cut Rate Gas", "Costco"], investmentAccounts: [{ id: 5, name: "Roth IRA" }] } as ParseContext;
  it.each([
    "Save A Lot last month",
    "Save A Lot spending in July",
    "save a lot this year",
    "Extra Space Storage last month",
    "Cut Rate Gas last month",
  ])("no scenario or preview reader claims a question that starts with a store name: %s", text => {
    expect(parseCutPreview(text, stores)).toBeNull();
    expect(parseSpendingScenario(text, stores)).toBeNull();
    expect(parseRetirementScenario(text, stores as never)).toBeNull();
  });
  it("a store called Save A Lot leaves a real amount-bearing saving instruction alone", () => {
    expect(parseCutPreview("Save $200 a month across Dining and Groceries from November through December 2026", stores)).not.toBeNull();
    expect(parseSpendingScenario("Save $50 on Dining each month from November through December 2026", stores)?.kind).toBe("scenario");
    // D-S4-02 protects whole recorded names, not "Save A" as a prefix of an
    // unknown name. Either refusing reader is safe; no financial draft is allowed.
    expect(parseQuestion("Save A Lotus last month", { ...stores, merchants: ["Save A Lot"] }).status).toBe("unsupported");
    expect(parseCutPreview("Save A Lotus last month", { ...stores, merchants: ["Save A Lot"] })?.kind).toBe("cut-preview-unsupported");
  });
  it("hands the whole question, name and period, to the ordinary reader", () => {
    const out = parseQuestion("Save A Lot last month", stores);
    expect(out).toMatchObject({ status: "query" });
    expect(JSON.stringify(out)).toMatch(/Save A Lot/i); expect(JSON.stringify(out)).toMatch(/2026-09-01/);
  });
});

describe("D-S4-02 (R3-08): an ordinary spending question may hold a store whose name holds an operator word anywhere in it", () => {
  const stores = { today: "2026-10-20", categories: ["Dining", "Groceries"], accounts: [], merchants: ["CUT ABOVE SALON", "REDUCE STRESS SPA", "EXTRA SPACE STORAGE #41", "SAVE A LOT #12"], members: [], investmentAccounts: [{ id: 5, name: "Roth IRA" }], historyStart: "2025-01-01" } as ParseContext;
  it.each([
    "spending at Cut Above last month",
    "total at Cut Above salon this year",
    "my spending at Reduce Stress last month",
    "Spending at Extra Space Storage in July",
    "what did I spend at Save A Lot in July",
  ])("is the ordinary reader's question, claimed by none of the three readers: %s", text => {
    expect(parseQuestion(text, stores).status).not.toBe("unsupported");
    expect(parseCutPreview(text, stores)).toBeNull();
    expect(parseSpendingScenario(text, stores)).toBeNull();
    expect(parseRetirementScenario(text, stores as never)).toBeNull();
  });
  it("still claims a real instruction that carries an amount, even beside such a store", () => {
    expect(parseSpendingScenario("Save $50 on Dining each month from November through December 2026", stores)?.kind).toBe("scenario");
    expect(parseSpendingScenario("Cut Dining by $50 a month at Cut Above from November through December 2026", stores)).not.toBeNull();
  });
  it("without the store in the list the same words are still refused as an unsupported scope, as before", () => {
    expect(parseSpendingScenario("spending at Cut Above last month", { ...stores, merchants: [] })).not.toBeNull();
  });
});

describe("M6 task4 review regressions: names, instructions and complete ordinary filters", () => {
  const ctx: ParseContext = { today: "2026-10-20", categories: ["Dining", "Groceries"], accounts: [],
    merchants: ["CUT ABOVE SALON", "SAVE A LOT #12", "CUT", "CUT DINING"],
    investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "Only Savings" }, { id: 7, name: "Extra" }], historyStart: "2025-01-01" };

  it.each([
    ["spending at Cut Above over $20 last month", "20.00", false],
    ["purchases at Cut Above at least $20 last month", "20.00", true],
  ])("preserves the ordinary purchase threshold and store: %s", (text, amount, inclusive) => {
    const ordinary = parseQuestion(text, ctx);
    expect(ordinary).toMatchObject({ status: "query", request: { vendors: ["cut above"], minimumPurchase: { amount, inclusive }, periods: [{ from: "2026-09-01", to: "2026-09-30" }] } });
    expect(parseCutPreview(text, ctx)).toBeNull();
    expect(parseRetirementScenario(text, { ...ctx, investmentAccounts: ctx.investmentAccounts! })).toBeNull();
    expect(parseSpendingScenario(text, ctx)).toBeNull();
  });
  it("a store named CUT does not erase the verb in category discovery", () => {
    expect(parseCutPreview("Which categories can I cut?", ctx)).toMatchObject({ kind: "cut-preview", draft: { categories: [], target: { kind: null, amount: null } } });
  });
  it("a store named CUT does not erase the verb in a complete dollar-word scenario", () => {
    const text = "Cut Dining by 50 dollars every month from November through December 2026";
    expect(parseSpendingScenario(text, ctx)).toMatchObject({ kind: "scenario", draft: { category: "Dining", reduction: { kind: "money", amount: "50" }, cadence: "monthly", horizon: { from: "2026-11-01", to: "2026-12-31" } } });
  });
  it("a genuine store/partial-cut ambiguity offers two meanings, and each replacement reaches only its chosen meaning", () => {
    const out = parseSpendingScenario("Cut Dining", ctx);
    expect(out?.kind).toBe("scenario-clarify");
    if (out?.kind !== "scenario-clarify") throw Error("Expected meaning clarification");
    expect(out.clarification.choices).toHaveLength(2);
    const replacements = out.clarification.replacements!;
    expect(replacements).toHaveLength(2);
    const ordinary = parseQuestion(replacements[0], ctx);
    // The ordinary store grammar's existing default is all recorded history.
    expect(ordinary).toMatchObject({ status: "query", request: { vendors: ["cut dining"] }, interpretation: { periods: [{ allRecords: true }] } });
    expect(parseSpendingScenario(replacements[0], ctx)).toBeNull();
    expect(parseSpendingScenario(replacements[1], ctx)).toMatchObject({ kind: "scenario", draft: { category: "Dining", reduction: null } });
  });
  it.each(["Only Savings", '"Only Savings"'])("account operator text stays literal: %s", name => {
    const text = `Save $50 a month into ${name} until June 2050`;
    const out = parseRetirementScenario(text, { ...ctx, investmentAccounts: ctx.investmentAccounts! });
    expect(out).toMatchObject({ kind: "retirement-clarify" });
    if (out?.kind !== "retirement-clarify") throw Error("Expected extra-money consent clarification");
    expect(parseRetirementScenario(out.clarification.replacements![0], { ...ctx, investmentAccounts: ctx.investmentAccounts! })).toMatchObject({ kind: "retirement", draft: { accountId: 6, extra: { kind: "monthly", amount: "50" }, retirementMonth: "2050-06" } });
  });
  it("a different account named Extra cannot erase an explicit additional-money marker", () => {
    expect(parseRetirementScenario("Save an extra $50 a month into Roth IRA until June 2050", { ...ctx, investmentAccounts: ctx.investmentAccounts! })).toMatchObject({ kind: "retirement", draft: { accountId: 5, extra: { amount: "50", kind: "monthly" } } });
  });
  it.each([
    "Save only $50 a month into Only Savings until June 2050",
    "Save $50 a month into Only Savings instead of $100 until June 2050",
  ])("replacement wording outside the actual name is still refused: %s", text => {
    expect(parseRetirementScenario(text, { ...ctx, investmentAccounts: ctx.investmentAccounts! })).toMatchObject({ kind: "retirement-unsupported" });
  });
  it("an ordinary store reading cannot erase an actual cut's unsupported store or condition clause", () => {
    expect(parseSpendingScenario("Cut Dining by $50 a month at Cut Above from November through December 2026", ctx)).toMatchObject({ kind: "scenario-unsupported" });
    expect(parseSpendingScenario("Cut Dining by $50 a month unless I visit Cut Above", ctx)).toMatchObject({ kind: "scenario-unsupported" });
  });
  it.each(["What If Cafe", "If We Eat"])("protects multi-word operators only when they are the recorded store: %s", merchant => {
    const text = `spending at ${merchant} last month`, roster = { ...ctx, merchants: [merchant] };
    expect(parseQuestion(text, roster)).toMatchObject({ status: "query" });
    expect(parseSpendingScenario(text, roster)).toBeNull();
  });
  it("the approved bare retirement refusal explains the explicit-extra wording without inferring an account", () => {
    expect(parseCutPreview("Save $50 a month for retirement", ctx)).toMatchObject({ kind: "cut-preview-unsupported", reason: expect.stringMatching(/extra|additional/i) });
  });
  it("keeps the approved multi-category and short-account boundaries as refusals", () => {
    expect(parseSpendingScenario("Save $50 on Dining and Groceries each month", ctx)).toMatchObject({ kind: "scenario-unsupported" });
    const text = "Save $50 a month into Roth until June 2050";
    expect(parseCutPreview(text, ctx)).toMatchObject({ kind: "cut-preview-unsupported" });
    expect(parseRetirementScenario(text, { ...ctx, investmentAccounts: ctx.investmentAccounts! })).toBeNull(); // No account alias inferred; the earlier reader refuses it.
  });
});
