import { describe, expect, it } from "vitest";
import { CORPUS_CONTEXTS, RETIREMENT_CORPUS, retirementCorpusDenominators, retirementExecutionExpectation, retirementScoringPlan } from "./retirementCorpus";
import { gradeRetirementCompletion } from "./retirementCompiledCorpus";
import { parseRetirementScenario } from "./retirementParser";

const boundary = RETIREMENT_CORPUS.find(c => c.id === "m5c-027")!;
const seeds = [101, 202, 303];
const observations = () => RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length)
  .flatMap(c => seeds.map(seed => ({ id: c.id, seed, completed: c.id !== boundary.id, clarified: false, numericRefused: c.id === boundary.id })));

describe("Owner-approved m5c-027 execution amendment", () => {
  it("keeps the original wording, parser draft and interpretation population", () => {
    expect(boundary.text).toBe("extra $100 a month into my Roth IRA until October 2100 at 100%");
    expect(boundary.expected.kind).toBe("retirement");
    if (boundary.expected.kind !== "retirement") throw Error("The frozen case must remain a retirement draft.");
    expect(parseRetirementScenario(boundary.text, CORPUS_CONTEXTS[boundary.context])).toEqual({ ...boundary.expected, draft: { ...boundary.expected.draft, sourceText: boundary.text } });
    expect(retirementCorpusDenominators()).toMatchObject({ total: 77, interpretationDrafts: 44, fullySpecifiedDrafts: 29 });
  });
  it("amends only this exact frozen execution case, not other completed drafts", () => {
    expect(retirementExecutionExpectation(boundary)).toBe("numeric-boundary-refusal");
    for (const c of RETIREMENT_CORPUS.filter(c => c.id !== boundary.id)) expect(retirementExecutionExpectation(c)).toBe("completed-estimate");
    expect(() => retirementExecutionExpectation({ ...boundary, text: "a changed question" })).toThrow();
  });
  it("separates 28 completion candidates from one post-consent numeric refusal without changing fractions", () => {
    expect(retirementCorpusDenominators()).toMatchObject({ balanceCompletionDrafts: 28, numericBoundaryRefusals: 1, refusals: 22 });
    const plan = retirementScoringPlan();
    expect(plan.populations).toMatchObject({ completion: { denominator: 28, requiredPassing: 27, fraction: 0.95 }, numericBoundaryRefusals: { denominator: 1, requiredFraction: 1 } });
    expect(plan.families["return-wording"]).toMatchObject({ fullySpecifiedDrafts: 7, completionDenominator: 6, numericBoundaryRefusals: 1, completionRequiredPassing: 6 });
  });
  it("requires the safe refusal on every seed and never credits it as an estimate", () => {
    expect(gradeRetirementCompletion(observations(), seeds)).toMatchObject({ pass: true, fullySpecifiedDrafts: 29, completionDenominator: 28, completedOnAllSeeds: 28, numericRefusalsOnAllSeeds: 1 });
    const missing = observations(); missing.find(o => o.id === boundary.id && o.seed === 202)!.numericRefused = false;
    expect(gradeRetirementCompletion(missing, seeds).pass).toBe(false);
  });
  it("fails a completed estimate, missing refusal observation, or clarification for the amended case", () => {
    const completed = observations(); completed.find(o => o.id === boundary.id)!.completed = true;
    expect(gradeRetirementCompletion(completed, seeds).pass).toBe(false);
    expect(gradeRetirementCompletion(observations().filter(o => !(o.id === boundary.id && o.seed === 303)), seeds).pass).toBe(false);
    const clarified = observations(); clarified.find(o => o.id === boundary.id)!.clarified = true;
    expect(gradeRetirementCompletion(clarified, seeds).pass).toBe(false);
  });
  it("does not allow a numeric refusal to replace an ordinary completed estimate", () => {
    const rows = observations(), ordinary = rows.find(o => o.id !== boundary.id)!;
    ordinary.completed = false; ordinary.numericRefused = true;
    expect(gradeRetirementCompletion(rows, seeds).pass).toBe(false);
  });
});
