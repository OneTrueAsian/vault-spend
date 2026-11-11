import { describe, expect, it } from "vitest";
import { RETIREMENT_CORPUS } from "./retirementCorpus";
import { gradeRetirementCompletion } from "./retirementCompiledCorpus";
import type { CompletionObservation } from "./retirementCompiledCorpus";

// Task item 3 (20 Oct 2026): a missing, duplicate, misclassified or failed observation must never produce a passing compiled gate, and the numeric refusal must be asserted, not inferred from a
// timeout or from the absence of a result. Authority: Corpus-Amendment-Review.md:12 (the refusal on every seed; missing, duplicate, failed, clarified or wrongly completed boundary observations
// fail acceptance), retirementCompiledCorpus.ts:20-50 (the grader). These are added characterization checks of the grader; they were not red first, so each is proved able to fail by a mutation run
// (see the report), not by a red run.
const SEEDS = [101, 202, 303];
const fullySpecified = RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length);
const BOUNDARY = "m5c-027";
const good = (): CompletionObservation[] => fullySpecified.flatMap(c => SEEDS.map(seed => (c.id === BOUNDARY
  ? { id: c.id, seed, completed: false, numericRefused: true, clarified: false }
  : { id: c.id, seed, completed: true, numericRefused: false, clarified: false })));
const grade = (observations: CompletionObservation[], seeds = SEEDS) => gradeRetirementCompletion(observations, seeds);
const without = (predicate: (o: CompletionObservation) => boolean) => good().filter(o => !predicate(o));
const change = (predicate: (o: CompletionObservation) => boolean, patch: Partial<CompletionObservation>) => good().map(o => (predicate(o) ? { ...o, ...patch } : o));
const boundary = (o: CompletionObservation) => o.id === BOUNDARY;

describe("the amended compiled grading cannot be satisfied by a missing, duplicate, misclassified or failed observation", () => {
  it("the complete, correct set passes: 28 estimates and the refusal on every seed", () => {
    const result = grade(good());
    expect(result).toMatchObject({ pass: true, completionDenominator: 28, completedOnAllSeeds: 28, numericRefusalsOnAllSeeds: 1, fullySpecifiedDrafts: 29, errors: [] });
  });
  it("a boundary row where nothing was observed (a timeout or the absence of any result) is a failure, not a pass", () => {
    const result = grade(change(o => boundary(o) && o.seed === 202, { completed: false, numericRefused: false, clarified: false }));
    expect(result.pass).toBe(false); expect(result.numericRefusalsOnAllSeeds).toBe(0);
  });
  it("the refusal observed on only two of the three seeds fails, whichever seed is missing", () => {
    for (const seed of SEEDS) { const result = grade(without(o => boundary(o) && o.seed === seed)); expect(result.pass, `seed ${seed} missing`).toBe(false); expect(result.errors.join(" ")).toMatch(/Missing or extra/); }
  });
  it("a duplicate boundary row cannot stand in for a missing seed, even though the total count then matches", () => {
    const rows = without(o => boundary(o) && o.seed === 303); rows.push({ id: BOUNDARY, seed: 101, completed: false, numericRefused: true, clarified: false });
    expect(rows.length).toBe(good().length);
    const result = grade(rows); expect(result.pass).toBe(false); expect(result.errors.join(" ")).toMatch(/Duplicate observation for m5c-027\/101/);
  });
  it("a refusal row that also clarified, or that also claims a completed estimate, fails (contradictory observations)", () => {
    expect(grade(change(o => boundary(o) && o.seed === 101, { clarified: true })).pass).toBe(false);
    expect(grade(change(o => boundary(o) && o.seed === 101, { completed: true })).pass).toBe(false);
  });
  it("the boundary case counted as a completed estimate fails and never adds to the 28", () => {
    const result = grade(change(boundary, { completed: true, numericRefused: false }));
    expect(result.pass).toBe(false); expect(result.completedOnAllSeeds).toBe(28); expect(result.numericRefusalsOnAllSeeds).toBe(0);
  });
  it("an ordinary candidate reported as a numeric refusal is rejected, and it earns no completion credit", () => {
    const result = grade(change(o => o.id === "m5c-001" && o.seed === 101, { completed: false, numericRefused: true }));
    expect(result.pass).toBe(false); expect(result.errors.join(" ")).toMatch(/ordinary completion cannot be replaced by a numeric refusal/i);
  });
  it("one estimate candidate failing on one seed removes that candidate from the count and fails its family", () => {
    const result = grade(change(o => o.id === "m5c-001" && o.seed === 202, { completed: false }));
    expect(result.completedOnAllSeeds).toBe(27);
    expect(result.pass).toBe(false); // 27 of 28 meets the global 95%, but a small family must have all of its candidates
  });
  it("an estimate row with a clarification is an unnecessary clarification and fails", () => {
    expect(grade(change(o => o.id === "m5c-001" && o.seed === 303, { clarified: true })).pass).toBe(false);
  });
  it("an observation for a case that is not a fully specified draft, or for a seed that was not requested, fails", () => {
    const needsChoices = RETIREMENT_CORPUS.find(c => c.expected.kind === "retirement" && c.expected.draft.missing.length > 0)!;
    expect(grade([...good(), { id: needsChoices.id, seed: 101, completed: true, numericRefused: false, clarified: false }]).pass).toBe(false);
    expect(grade([...good(), { id: "m5c-001", seed: 404, completed: true, numericRefused: false, clarified: false }]).pass).toBe(false);
  });
  it("fewer than three distinct positive seeds can never pass, even with every row present", () => {
    for (const seeds of [[101, 202], [101, 101, 202], [101, 202, -3], [101, 202, 1.5]]) {
      const rows = fullySpecified.flatMap(c => seeds.map(seed => (c.id === BOUNDARY ? { id: c.id, seed, completed: false, numericRefused: true, clarified: false } : { id: c.id, seed, completed: true, numericRefused: false, clarified: false })));
      const result = grade(rows, seeds);
      expect(result.pass, JSON.stringify(seeds)).toBe(false);
      expect(result.errors.join(" "), JSON.stringify(seeds)).toMatch(/at least three distinct positive ledger seeds/); // the refusal is explained, not a side effect of another guard
    }
  });
  it("an empty set of observations never passes", () => expect(grade([]).pass).toBe(false));
});
