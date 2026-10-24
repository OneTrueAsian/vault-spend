import { describe, expect, it } from "vitest";
import { CORPUS_CONTEXTS, RETIREMENT_CORPUS } from "./retirementCorpus";
import { compiledRetirementCase, gradeRetirementCompletion } from "./retirementCompiledCorpus";
import { parseRetirementScenario } from "./retirementParser";

const zero = RETIREMENT_CORPUS.find(c => c.id === "m5c-022")!;
describe("approved compiled corpus date adaptation (O1)", () => {
  it.each([
    ["2026-10-19", "October 2026", "2026-10"],
    ["2027-01-01", "January 2027", "2027-01"],
    ["2028-02-29", "February 2028", "2028-02"],
    ["2100-12-31", "December 2100", "2100-12"],
  ])("keeps the once-extra zero-month purpose at %s", (today, label, month) => {
    const before = structuredClone(zero), variant = compiledRetirementCase(zero, today);
    expect(variant).toMatchObject({ id: zero.id, originalText: zero.text, appDate: today, adapted: true, retirementMonth: month });
    expect(variant.text).toBe(`a one-time $500 deposit to my Roth IRA now, retiring ${label}`);
    const parsed = parseRetirementScenario(variant.text, { ...CORPUS_CONTEXTS.single, today });
    expect(parsed?.kind).toBe("retirement");
    if (parsed?.kind !== "retirement") throw Error("The approved variant must remain a complete retirement draft");
    expect(parsed.draft).toMatchObject({ accountId: 5, extra: { kind: "once", amount: "500" }, startDate: today, retirementMonth: month, missing: [] });
    expect(zero).toEqual(before);
  });
  it("keeps the literal frozen case valid at its corpus date and refused once its month has passed", () => {
    expect(parseRetirementScenario(zero.text, CORPUS_CONTEXTS.single)?.kind).toBe("retirement");
    expect(parseRetirementScenario(zero.text, { ...CORPUS_CONTEXTS.single, today: "2026-10-19" })?.kind).toBe("retirement-unsupported");
  });
  it("does not rewrite other corpus questions or change completion populations", () => {
    const complete = RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length);
    expect(complete).toHaveLength(29); expect(complete.filter(c => c.family === "once-extra")).toHaveLength(4);
    for (const c of complete.filter(c => c.id !== zero.id)) {
      const v = compiledRetirementCase(c, "2026-10-19"); expect(v.text).toBe(c.text); expect(v.adapted).toBe(false);
      expect(v.retirementMonth).toBe(c.expected.kind === "retirement" ? c.expected.draft.retirementMonth : null);
    }
  });
  it.each(["2026-02-30", "2026-2-03", "2101-01-01", "", "2026-10-19T00:00:00Z"])("refuses invalid/out-of-range run date %s without guessing a clock", today => {
    expect(() => compiledRetirementCase(zero, today)).toThrow();
  });
  it("refuses a changed case disguised under the approved ID", () => {
    expect(() => compiledRetirementCase({ ...zero, text: "a one-time $900 deposit to my Roth IRA now, retiring September 2026" }, "2026-10-19")).toThrow();
  });
});

describe("compiled completion process gates cannot hide a family or seed failure", () => {
  const seeds = [101, 202, 303];
  const observations = () => RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length)
    .flatMap(c => seeds.map(seed => ({ id: c.id, seed, completed: c.id !== "m5c-027", numericRefused: c.id === "m5c-027", clarified: false })));
  it("accepts 28 estimates and the separate numeric refusal only on every seed", () => {
    expect(gradeRetirementCompletion(observations(), seeds)).toMatchObject({ pass: true, completedOnAllSeeds: 28, numericRefusalsOnAllSeeds: 1, families: { "once-extra": { passed: 4, pass: true } } });
  });
  it("fails the once-extra family even when 27 of 28 meets the global percentage", () => {
    const rows = observations(); rows.find(o => o.id === zero.id && o.seed === 202)!.completed = false;
    expect(gradeRetirementCompletion(rows, seeds)).toMatchObject({ pass: false, completedOnAllSeeds: 27, families: { "once-extra": { passed: 3, pass: false } } });
  });
  it("does not count a missing or duplicate seed observation as completion", () => {
    const rows = observations(); rows.pop(); expect(gradeRetirementCompletion(rows, seeds).pass).toBe(false);
    rows.push(rows[0]); expect(gradeRetirementCompletion(rows, seeds).pass).toBe(false);
  });
  it("does not count unknown cases or unrequested seeds", () => {
    const rows = observations(); rows[0].id = "invented-case"; expect(gradeRetirementCompletion(rows, seeds).pass).toBe(false);
    const badSeed = observations(); badSeed[0].seed = 999; expect(gradeRetirementCompletion(badSeed, seeds).pass).toBe(false);
  });
  it("requires at least three distinct ledger seeds", () => {
    expect(gradeRetirementCompletion(observations(), [101]).pass).toBe(false);
    expect(gradeRetirementCompletion(observations(), [101, 101, 202]).pass).toBe(false);
  });
});
