import { describe, expect, it } from "vitest";
import { CORPUS_CONTEXTS, RETIREMENT_CORPUS } from "./retirementCorpus";
import { parseRetirementScenario } from "./retirementParser";

describe("P3 synchronous claiming of quoted investment names", () => {
  it.each(["Vanguard Fund", "Income Plan", "Fees and Taxes"])("claims a named investment %s without a retirement keyword or leading extra", name => {
    const parsed = parseRetirementScenario(`put $50 a month into "${name}" until January 2056`, { today: "2026-10-19", investmentAccounts: [{ id: 9, name }] });
    expect(parsed?.kind).toBe("retirement");
    if (parsed?.kind !== "retirement") throw Error("A known quoted investment account must reach M5");
    expect(parsed.draft).toMatchObject({ accountId: 9, extra: { kind: "monthly", amount: "50" }, retirementMonth: "2056-01", missing: [] });
  });
  it("keeps unsupported clauses outside the quoted account name", () => {
    const parsed = parseRetirementScenario('put $50 a month into "Vanguard Fund" until January 2056 only if I get a raise', { today: "2026-10-19", investmentAccounts: [{ id: 9, name: "Vanguard Fund" }] });
    expect(parsed?.kind).toBe("retirement-unsupported");
  });
  it.each([['Vanguard Fund', 'Vanguard   Fund'], ['Rothé Plan', 'Rothe\u0301 Plan']])("uses the parser's existing name normalization for claiming %s", (name, typed) => {
    const parsed = parseRetirementScenario(`put $50 a month into "${typed}" until January 2056`, { today: "2026-10-19", investmentAccounts: [{ id: 9, name }] });
    expect(parsed?.kind).toBe("retirement");
  });
});
import { retirementUnsupportedMessage } from "./retirementScreenContract";
import { validateRetirementDraft } from "./retirementScenarioContract";

describe("M5 P1–P3 frozen semantic corpus, including complete clarification reparse", () => {
  for (const c of RETIREMENT_CORPUS) it(`${c.id} ${c.text.trim()}`, () => {
    const context = structuredClone(CORPUS_CONTEXTS[c.context]), original = structuredClone(context);
    const got = parseRetirementScenario(c.text, context), want = c.expected;
    expect(context).toEqual(original);
    if (want.kind === "route-elsewhere") expect(got).toBeNull();
    else if (want.kind === "retirement") {
      expect(got).toEqual({ kind: "retirement", draft: { sourceText: c.text, ...want.draft } });
      if (got?.kind === "retirement") expect(validateRetirementDraft(got.draft, context)).toEqual({ ok: true });
    } else if (want.kind === "retirement-unsupported") expect(got).toEqual({ kind: want.kind, reason: retirementUnsupportedMessage(want.reasonCode) });
    else {
      expect(got).toEqual({ kind: "retirement-clarify", clarification: { status: "clarify", reason: want.why, choices: want.choices.map(x => x.label), replacements: want.choices.map(x => x.replacementQuestion) } });
      if (got?.kind === "retirement-clarify") for (const [i, replacement] of got.clarification.replacements!.entries())
        expect(parseRetirementScenario(replacement, context)).toEqual({ kind: "retirement", draft: { sourceText: replacement, ...want.choices[i].next.draft } });
    }
  });
});

const context = CORPUS_CONTEXTS.single;
const base = "extra $50 a month into my Roth IRA until June 2050";
describe("P3 adversarial material clauses cannot be silently discarded", () => {
  it.each([
    `${base} except on Tuesdays`, `${base} unless I lose my job`, `${base} but don't add it`,
    `${base} at Costco`, `${base} for Alex`,
    `${base} at 5% and 7%`, `${base} with 2% inflation and 3% inflation`,
    `${base} or $75 a month`, `${base} every week`, `${base} until July 2051`,
    `${base} if I save`,
    `${base} and how much did I spend on groceries`,
    'extra $50 a month into "Roth IRA until June 2050',
    "don't add $50 a month to my Roth IRA until June 2050",
    "extra $-50 a month into my Roth IRA until June 2050",
    "extra $1,00 a month into my Roth IRA until June 2050",
    "extra $1e3 a month into my Roth IRA until June 2050",
  ])("refuses or clarifies the complete request: %s", text => {
    const got = parseRetirementScenario(text, context);
    expect(got).not.toBeNull(); expect(got?.kind).not.toBe("retirement");
  });
  it.each([".", "?", "!"])("accepts trailing punctuation %s without losing source spans", suffix => {
    const got = parseRetirementScenario(base + suffix, context);
    expect(got?.kind).toBe("retirement");
    if (got?.kind === "retirement") expect(validateRetirementDraft(got.draft, context)).toEqual({ ok: true });
  });
  it("protects quoted operator words from unsupported-clause detection", () => {
    const c = { ...context, investmentAccounts: [{ id: 8, name: "Tax and Fees" }] };
    expect(parseRetirementScenario('extra $50 a month into "Tax and Fees" until June 2050', c)?.kind).toBe("retirement");
  });
  it("retains a future start as an unresolved choice, never moves it to today", () => {
    const got = parseRetirementScenario(`${base} starting January 2028`, context);
    expect(got?.kind).toBe("retirement");
    if (got?.kind === "retirement") { expect(got.draft.startDate).toBeNull(); expect(got.draft.hints).toContainEqual(expect.objectContaining({ field: "start-date", text: "starting January 2028" })); }
  });
  it("does not use the machine clock", () => {
    const c = { ...context, today: "2028-12-31" };
    const got = parseRetirementScenario("extra $50 a month into my Roth IRA until June", c);
    expect(got?.kind).toBe("retirement-clarify");
    if (got?.kind === "retirement-clarify") expect(got.clarification.choices).toEqual(["June 2029", "June 2030", "June 2031"]);
  });
  it("refuses invalid app context rather than guessing dates or account ids", () => {
    expect(parseRetirementScenario(base, { ...context, today: "2026-02-30" })?.kind).toBe("retirement-unsupported");
  });
  it.each([null, {}, { today: context.today, investmentAccounts: {} }, { today: context.today, investmentAccounts: [null] }])("malformed context refuses safely: %j", value => {
    expect(() => parseRetirementScenario(base, value as never)).not.toThrow();
    expect(parseRetirementScenario(base, value as never)?.kind).toBe("retirement-unsupported");
  });
  it("never treats operator words in a literal account as an instruction", () => {
    const name = "Income and Employer Match";
    const c = { ...context, investmentAccounts: [{ id: 9, name }] };
    expect(parseRetirementScenario(`extra $50 a month into "${name}" until June 2050`, c)?.kind).toBe("retirement");
  });
  it.each(["Income Plan", "Enough for Retirement", "Employer Match IRA", "Spending IRA"])("protects an exact unquoted account name too: %s", name => {
    const c = { ...context, investmentAccounts: [{ id: 9, name }] };
    expect(parseRetirementScenario(`extra $50 a month into my ${name} until June 2050`, c)?.kind).toBe("retirement");
  });
  it("an explicitly stated start on the app-owned current day does not require a future-start acknowledgement", () => {
    const got = parseRetirementScenario("one-time $50 into my Roth IRA on September 6 2026, retiring June 2050", context);
    expect(got?.kind).toBe("retirement");
    if (got?.kind === "retirement") { expect(got.draft.startDate).toBe(context.today); expect(got.draft.missing).not.toContain("start-date"); expect(got.draft.hints).toContainEqual(expect.objectContaining({ field: "start-date", text: "on September 6 2026" })); }
  });
  it.each(["on February 30 2027", "on September 5 2026"])("invalid or past explicit start refuses, rather than suggesting a different valid date: %s", start => {
    expect(parseRetirementScenario(`one-time $50 into my Roth IRA ${start}, retiring June 2050`, context)?.kind).toBe("retirement-unsupported");
  });
});

describe("an account whose own name contains a clause word is still found when the name is typed in full", () => {
  const NAME = "Long Name Account with a very long label for retirement savings and also more";
  const ctx = { today: "2026-10-19", investmentAccounts: [{ id: 1, name: NAME }, { id: 2, name: "Roth IRA" }] };
  const ask = (name: string, tail = " until January 2056") => parseRetirementScenario(`How much would an extra $50 a month into ${name}${tail} add?`, ctx as never);
  it("reads the full roster name even though it contains with, for, and also", () => {
    const out = ask(NAME);
    expect(out).toMatchObject({ kind: "retirement" });
    expect((out as { draft: { accountId: number } }).draft.accountId).toBe(1);
  });
  it("still treats a clause word after the name as the end of the name", () => {
    const out = ask("Roth IRA", " with a 5% return until January 2056");
    expect((out as { draft: { accountId: number } }).draft.accountId).toBe(2);
  });
  it("does not accept a shortened version of the long name", () => {
    const out = ask("Long Name Account");
    expect(out?.kind === "retirement" ? out.draft.accountId : null).not.toBe(1);
  });
});

describe("a question that ends by asking what the extra money would add", () => {
  const ctx = { today: "2026-10-19", investmentAccounts: [{ id: 1, name: "Roth IRA" }, { id: 2, name: "Brokerage" }] };
  it.each([
    ["How much would an extra $50 a month into Roth IRA add?", 1],
    ["How much would an extra $50 a month into my Roth IRA add?", 1],
    ["how much would extra $100 a month into the Brokerage add", 2],
  ])("finds the account before the trailing add: %s", (question, id) => {
    const out = parseRetirementScenario(question, ctx as never);
    expect(out).toMatchObject({ kind: "retirement" });
    const draft = (out as { draft: { accountId: number; missing: string[] } }).draft;
    expect(draft.accountId).toBe(id);
    expect(draft.missing).toEqual(["retirement-month"]);
  });
  it("does not invent an account that is not in the list", () => {
    const out = parseRetirementScenario("How much would an extra $50 a month into my retirement club add?", ctx as never);
    expect(out === null || out.kind !== "retirement").toBe(true);
  });
});
