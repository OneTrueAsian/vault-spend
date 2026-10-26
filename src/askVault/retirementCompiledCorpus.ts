import type { CorpusCase } from "./retirementCorpus";
import { RETIREMENT_CORPUS, retirementExecutionExpectation, retirementScoringPlan } from "./retirementCorpus";
import { date as isDate } from "../contractChecks";
import { dateOutOfRange } from "../dateRange";

/** Owner-approved test-driver adaptation, never imported by the app or used to change parser outcomes. */
export function compiledRetirementCase(c: CorpusCase, today: string) {
  if (!isDate(today) || dateOutOfRange(today)) throw new Error("Use the current supported app date for compiled acceptance.");
  const base = { id: c.id, originalText: c.text, text: c.text, appDate: today, retirementMonth: c.expected.kind === "retirement" ? c.expected.draft.retirementMonth : null, adapted: false };
  if (c.id !== "m5c-022") return base;
  const frozen = RETIREMENT_CORPUS.find(entry => entry.id === c.id);
  if (!frozen || JSON.stringify(frozen) !== JSON.stringify(c)) throw new Error("The approved zero-month fixture has changed; review the adaptation explicitly.");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const label = `${names[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}`;
  return { ...base, text: c.text.replace("September 2026", label), retirementMonth: today.slice(0, 7), adapted: true };
}

export type CompletionObservation = { id: string; seed: number; completed: boolean; clarified: boolean; numericRefused?: boolean };
/** Estimates and the separate numeric refusal are observed after consent on every seed. Neither a global pass nor a safe refusal replaces a required family estimate. */
export function gradeRetirementCompletion(observations: CompletionObservation[], seeds: number[]) {
  const fullySpecified = RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length);
  const complete = fullySpecified.filter(c => retirementExecutionExpectation(c) === "completed-estimate");
  const numeric = fullySpecified.filter(c => retirementExecutionExpectation(c) === "numeric-boundary-refusal");
  const plan = retirementScoringPlan(), errors: string[] = [];
  if (seeds.length < 3 || new Set(seeds).size !== seeds.length || seeds.some(seed => !Number.isSafeInteger(seed) || seed <= 0)) errors.push("Use at least three distinct positive ledger seeds.");
  const rows = new Map<string, Map<number, CompletionObservation>>();
  for (const observation of observations) {
    if (!fullySpecified.some(c => c.id === observation.id) || !seeds.includes(observation.seed)) { errors.push("Unexpected case or ledger seed."); continue; }
    if (observation.numericRefused && !numeric.some(c => c.id === observation.id)) errors.push("An ordinary completion cannot be replaced by a numeric refusal.");
    const group = rows.get(observation.id) ?? new Map<number, CompletionObservation>();
    if (group.has(observation.seed)) errors.push(`Duplicate observation for ${observation.id}/${observation.seed}.`);
    group.set(observation.seed, observation); rows.set(observation.id, group);
  }
  const passed = new Set(complete.filter(c => seeds.length >= 3 && seeds.every(seed => {
    const row = rows.get(c.id)?.get(seed); return row?.completed === true && row.clarified === false;
  })).map(c => c.id));
  if (observations.length !== fullySpecified.length * seeds.length) errors.push("Missing or extra execution observations.");
  const numericRefusals = numeric.filter(c => seeds.length >= 3 && seeds.every(seed => {
    const row = rows.get(c.id)?.get(seed); return row?.numericRefused === true && row.completed === false && row.clarified === false;
  })).length;
  const unnecessaryClarifications = complete.filter(c => seeds.some(seed => rows.get(c.id)?.get(seed)?.clarified === true)).length;
  const families = Object.fromEntries(Object.values(plan.families).map(f => {
    const count = complete.filter(c => c.family === f.family && passed.has(c.id)).length;
    return [f.family, { passed: count, denominator: f.completionDenominator, required: f.completionRequiredPassing,
      pass: f.completionApplicable ? count >= f.completionRequiredPassing! : null }];
  }));
  return { pass: errors.length === 0 && passed.size >= plan.populations.completion.requiredPassing && numericRefusals === numeric.length &&
    unnecessaryClarifications <= plan.populations.unnecessaryClarification.allowedAtMost && Object.values(families).every(f => f.pass !== false),
  fullySpecifiedDrafts: fullySpecified.length, completionDenominator: complete.length, completedOnAllSeeds: passed.size, numericRefusalsOnAllSeeds: numericRefusals, unnecessaryClarifications, families, errors };
}
