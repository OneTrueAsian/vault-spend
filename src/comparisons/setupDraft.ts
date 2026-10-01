// Pure edits of a comparison setup draft. Every function returns a new object; none mutates its
// input. The backend validates again on save, so these only keep a draft well-formed while it is edited.
import type {
  AgeInput,
  ComparisonMode,
  ComparisonSetup,
  DebtClass,
  InvestmentClass,
  ManualAmount,
  MetricId,
  PersonRef,
  SourceRef,
  Universe,
} from "./types";

export const SETUP_FORMAT_VERSION = 1;
export const MIN_AGE = 18;
export const MAX_AGE = 120;

export function emptySetup(mode: ComparisonMode): ComparisonSetup {
  return {
    formatVersion: SETUP_FORMAT_VERSION,
    mode,
    householdReferencePerson: null,
    individualPerson: null,
    people: [],
    income: { householdMethod: "total", householdTotal: null, perPerson: [] },
    spending: { period: null, accountIds: [], completenessConfirmed: false, manualAnnual: null, categoryMappings: [] },
    savingsOverrides: [],
    investmentClasses: [],
    debtClasses: [],
    debtExclusions: [],
    allocations: [],
    balanceConfirmations: [],
    manualOverrides: [],
    cohortChoices: [],
    universePreferences: [],
  };
}

export const personKey = (p: PersonRef): string => (p.kind === "owner" ? "owner" : `member:${p.id}`);
export const samePerson = (a: PersonRef | null, b: PersonRef | null): boolean => a !== null && b !== null && personKey(a) === personKey(b);
export const sourceKey = (s: SourceRef): string => `${s.kind}:${s.id}`;
const sameSource = (a: SourceRef, b: SourceRef) => sourceKey(a) === sourceKey(b);

/** Lists the owner and every family member once. Anyone already listed (including a member who has
 * since been deleted) is left exactly as it is, so a repair stays visible instead of vanishing. */
export function syncPeople(setup: ComparisonSetup, members: { id: number; name: string }[]): ComparisonSetup {
  const have = new Set(setup.people.map((p) => personKey(p.person)));
  const wanted: PersonRef[] = [{ kind: "owner" }, ...members.map((m): PersonRef => ({ kind: "member", id: m.id }))];
  const added = wanted.filter((p) => !have.has(personKey(p))).map((person) => ({ person, age: null, inHousehold: true }));
  return added.length === 0 ? setup : { ...setup, people: [...setup.people, ...added] };
}

export const setMode = (setup: ComparisonSetup, mode: ComparisonMode): ComparisonSetup => ({ ...setup, mode });

export function setReferencePerson(setup: ComparisonSetup, person: PersonRef | null): ComparisonSetup {
  return setup.mode === "household" ? { ...setup, householdReferencePerson: person } : { ...setup, individualPerson: person };
}

function mapPerson(setup: ComparisonSetup, person: PersonRef, f: (p: ComparisonSetup["people"][number]) => ComparisonSetup["people"][number]) {
  return { ...setup, people: setup.people.map((p) => (samePerson(p.person, person) ? f(p) : p)) };
}

export function setAge(setup: ComparisonSetup, person: PersonRef, age: AgeInput | null, today: string): ComparisonSetup {
  return mapPerson(setup, person, (p) => ({ ...p, age: age ? { age, confirmedOn: today } : null }));
}

export function setInHousehold(setup: ComparisonSetup, person: PersonRef, inHousehold: boolean): ComparisonSetup {
  const next = mapPerson(setup, person, (p) => ({ ...p, inHousehold }));
  const loses = !inHousehold && samePerson(setup.householdReferencePerson, person);
  return loses ? { ...next, householdReferencePerson: null } : next;
}

export type AgeEntry = { kind: "exact"; age: string } | { kind: "band"; min: string; max: string };

function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? parseInt(t, 10) : null;
}

/** Validates what was typed. Exact ages and bands are equally supported inputs. */
export function parseAgeEntry(entry: AgeEntry): { ok: AgeInput } | { error: string } {
  const range = `Enter an age from ${MIN_AGE} to ${MAX_AGE}.`;
  if (entry.kind === "exact") {
    const age = wholeNumber(entry.age);
    if (age === null || age < MIN_AGE || age > MAX_AGE) return { error: range };
    return { ok: { kind: "exact", age } };
  }
  const min = wholeNumber(entry.min);
  const max = entry.max.trim() === "" ? null : wholeNumber(entry.max);
  if (min === null || min < MIN_AGE || min > MAX_AGE) return { error: `The first age: ${range}` };
  if (entry.max.trim() !== "" && (max === null || max > MAX_AGE)) return { error: `The last age: ${range}` };
  if (max !== null && max < min) return { error: "The last age cannot be younger than the first." };
  return { ok: { kind: "band", min, max } };
}

/** Plain dollars: optional "$", thousands commas, at most two decimals, optional leading minus. */
export function parseMoneyText(text: string): { ok: string } | { error: string } {
  const t = text.trim().replace(/^(-?)\$/, "$1").replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return { error: "Enter a dollar amount like 85000 or 85,000.50." };
  return { ok: t };
}

export function percentToBasisPoints(text: string): { ok: number } | { error: string } {
  const t = text.trim().replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Enter a percentage like 60 or 33.33." };
  const bp = Math.round(parseFloat(t) * 100);
  return bp > 10000 ? { error: "A share cannot be more than 100%." } : { ok: bp };
}

export function basisPointsToPercent(bp: number): string {
  return String(bp / 100);
}

export function allocationTotalBasisPoints(setup: ComparisonSetup, source: SourceRef): number {
  return setup.allocations.filter((a) => sameSource(a.source, source)).reduce((sum, a) => sum + a.basisPoints, 0);
}

/** Sets one person's share of one source; zero removes it. */
export function setAllocation(setup: ComparisonSetup, source: SourceRef, person: PersonRef, basisPoints: number): ComparisonSetup {
  const others = setup.allocations.filter((a) => !(sameSource(a.source, source) && samePerson(a.person, person)));
  return { ...setup, allocations: basisPoints > 0 ? [...others, { source, person, basisPoints }] : others };
}

function replaceBySource<T extends { source: SourceRef }>(list: T[], source: SourceRef, entry: T | null): T[] {
  const kept = list.filter((e) => !sameSource(e.source, source));
  return entry ? [...kept, entry] : kept;
}

export const setInvestmentClass = (setup: ComparisonSetup, source: SourceRef, cls: InvestmentClass | null): ComparisonSetup => ({
  ...setup,
  investmentClasses: replaceBySource(setup.investmentClasses, source, cls ? { source, class: cls } : null),
});

export const setDebtClass = (setup: ComparisonSetup, source: SourceRef, cls: DebtClass | null): ComparisonSetup => ({
  ...setup,
  debtClasses: replaceBySource(setup.debtClasses, source, cls ? { source, class: cls } : null),
});

export function setDebtExcluded(setup: ComparisonSetup, source: SourceRef, excluded: boolean): ComparisonSetup {
  const kept = setup.debtExclusions.filter((s) => !sameSource(s, source));
  return { ...setup, debtExclusions: excluded ? [...kept, source] : kept };
}

export const setSavingsOverride = (setup: ComparisonSetup, source: SourceRef, include: boolean | null): ComparisonSetup => ({
  ...setup,
  savingsOverrides: replaceBySource(setup.savingsOverrides, source, include === null ? null : { source, include }),
});

export function confirmBalances(setup: ComparisonSetup, metric: MetricId, today: string): ComparisonSetup {
  const kept = setup.balanceConfirmations.filter((c) => c.metric !== metric);
  return { ...setup, balanceConfirmations: [...kept, { metric, confirmedOn: today }] };
}

export function setManualOverride(setup: ComparisonSetup, metric: MetricId, subject: PersonRef | null, amount: ManualAmount | null): ComparisonSetup {
  const same = (o: ComparisonSetup["manualOverrides"][number]) => o.metric === metric && (subject === null ? o.subject === null : samePerson(o.subject, subject));
  const index = setup.manualOverrides.findIndex(same);
  if (amount === null) return { ...setup, manualOverrides: setup.manualOverrides.filter((o) => !same(o)) };
  const entry = { metric, subject, amount };
  if (index < 0) return { ...setup, manualOverrides: [...setup.manualOverrides, entry] };
  return { ...setup, manualOverrides: setup.manualOverrides.map((o, i) => (i === index ? entry : o)) };
}

export function setCohortChoice(setup: ComparisonSetup, mode: ComparisonMode, metric: MetricId, referenceId: string | null): ComparisonSetup {
  const kept = setup.cohortChoices.filter((c) => !(c.mode === mode && c.metric === metric));
  return { ...setup, cohortChoices: referenceId ? [...kept, { mode, metric, referenceId }] : kept };
}

export function setUniversePreference(setup: ComparisonSetup, metric: MetricId, universe: Universe | null): ComparisonSetup {
  const kept = setup.universePreferences.filter((p) => p.metric !== metric);
  return { ...setup, universePreferences: universe ? [...kept, { metric, universe }] : kept };
}

export const setHouseholdIncomeMethod = (setup: ComparisonSetup, method: "total" | "by_person"): ComparisonSetup => ({
  ...setup,
  income: { ...setup.income, householdMethod: method },
});

export const setHouseholdTotal = (setup: ComparisonSetup, amount: ManualAmount | null): ComparisonSetup => ({
  ...setup,
  income: { ...setup.income, householdTotal: amount },
});

export function setPersonIncome(setup: ComparisonSetup, person: PersonRef, amount: ManualAmount | null): ComparisonSetup {
  const kept = setup.income.perPerson.filter((e) => !samePerson(e.person, person));
  return { ...setup, income: { ...setup.income, perPerson: amount ? [...kept, { person, grossAnnual: amount }] : kept } };
}

export const setSpendingCompleteness = (setup: ComparisonSetup, confirmed: boolean): ComparisonSetup => ({
  ...setup,
  spending: { ...setup.spending, completenessConfirmed: confirmed },
});

export const setManualAnnualSpending = (setup: ComparisonSetup, amount: ManualAmount | null): ComparisonSetup => ({
  ...setup,
  spending: { ...setup.spending, manualAnnual: amount },
});

export function setSpendingAccount(setup: ComparisonSetup, accountId: number, included: boolean): ComparisonSetup {
  const kept = setup.spending.accountIds.filter((id) => id !== accountId);
  return { ...setup, spending: { ...setup.spending, accountIds: included ? [...kept, accountId] : kept } };
}
