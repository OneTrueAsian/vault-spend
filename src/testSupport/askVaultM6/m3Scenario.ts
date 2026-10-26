import { createHash } from "node:crypto";
import { canonical } from "./counting";
import type { CorpusCase } from "./manifest";

/**
 * Task-4 item 6, M3 conversion (owner instruction of 21 October 2026). The retained M3 financial catalogue (M3/integration/financial-corpus.test.ts) generated 480 prompts
 * from templates with the gold intent written beside each row (category, amount, kind, cadence, the fixed Nov-Dec 2026 or 15 Nov 2026 schedule), never read from the parser.
 * They are rebuilt here verbatim and become M6 cases with
 *  - the FULL intended request: the gold intent (60 distinct intents);
 *  - a separate exact result per seed (60 intents x 3 seeds = 180 references) from an independent integer-cent calculator over the seed's NATIVE baseline read
 *    (scenarioNativeReferences.json, validated by the focused native test): only the months the native read marks complete are used, as M3 Contract.md:25 requires;
 *  - the consent path the review requires: with 1 or 2 complete months the person must explicitly accept the months there are (a history review, reported separately and
 *    never a meaning clarification).
 * The ledger is the origin-101 world (today 2026-09-06) on seeds 101, 202 and 303, so "November through December 2026" and "15 November 2026" are prospective on all three.
 * Provenance caveat carried from the source: implementer-generated catalogue variants, not independent or unseen language.
 */
export const M3_TODAY = "2026-09-06";
export const M3_SEEDS = [101, 202, 303];
export const M3_CATEGORIES = ["Dining", "Dining Out", "Groceries"];
export const m3WorldId = (seed: number) => `origin-101-seed-${seed}`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export type M3Row = { text: string; category: string; amount: string; kind: "money" | "percent"; cadence: "monthly" | "once" };
export function m3Rows(): M3Row[] {
  const money = ["0", "0.01", "0.03", "1", "25", "50", "99.99", "100"], percents = ["0", "0.01", "33.33", "100"], cadences = ["monthly", "each month", "per month"], rows: M3Row[] = [];
  const templates = [
    (c: string, a: string, d: string) => `How much would I save if I spent $${a} less ${d} on ${c} from November through December 2026?`,
    (c: string, a: string, d: string) => `What if I cut ${c} by $${a} ${d} from November through December 2026?`,
    (c: string, a: string, d: string) => `If I reduced ${c} by ${a} dollars ${d} from 2026-11-01 to 2026-12-31, how much would I save?`,
    (c: string, a: string, d: string) => `What if I spent ${a}$ less on ${c} ${d} from November to December 2026?`];
  const pctTemplates = [
    (c: string, a: string, d: string) => `What if I reduced ${c} by ${a}% ${d} from November through December 2026?`,
    (c: string, a: string, d: string) => `Cut ${c} by ${a}% ${d} from November to December 2026.`,
    (c: string, a: string, d: string) => `What if I spent ${a}% less on ${c} ${d} from 2026-11-01 to 2026-12-31?`,
    (c: string, a: string, d: string) => `How much would I save if I cut ${c} by ${a}% ${d} from November to December 2026?`];
  for (const category of M3_CATEGORIES) for (const amount of money) for (const cadence of cadences) for (const t of templates) rows.push({ text: t(category, amount, cadence), category, amount, kind: "money", cadence: "monthly" });
  for (const category of M3_CATEGORIES) for (const amount of percents) for (const cadence of cadences) for (const t of pctTemplates) rows.push({ text: t(category, amount, cadence), category, amount, kind: "percent", cadence: "monthly" });
  for (const category of M3_CATEGORIES) for (const amount of money) for (const text of [`What if I cut ${category} by $${amount} once on November 15, 2026?`, `Spend $${amount} less on ${category} once on 2026-11-15.`])
    rows.push({ text, category, amount, kind: "money", cadence: "once" });
  return rows;
}
/** The full intended request: the scenario intent, written from the row, never from the parser. */
export function m3Intent(row: M3Row) {
  return { version: 1, category: row.category, reduction: { kind: row.kind, amount: row.amount }, cadence: row.cadence,
    horizon: row.cadence === "once" ? { kind: "prospective", from: "2026-11-15", to: "2026-11-15" } : { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, partialMonth: row.cadence === "once" ? "none" : "exclude" };
}
export const m3RequestId = (row: M3Row) => "m3q-" + sha(canonical(m3Intent(row))).slice(0, 16);
export const m3ReferenceId = (requestId: string, seed: number) => `m3r-${requestId.slice(4)}-${seed}`;
export const m3Population = (_row: M3Row) => "P-CORE" as const;
export const m3Family = (row: M3Row) => (row.kind === "percent" ? "m3:monthly-percentage" : row.cadence === "once" ? "m3:one-time-money" : "m3:monthly-money");

/** Case ids are the row's position; `outcomes` says what each seed's native baseline makes of the intent ("preview" or "refused"). */
export function m3Cases(outcome: (requestId: string, seed: number) => "preview" | "refused"): { cases: CorpusCase[]; mixed: string[]; refusedEverywhere: CorpusCase[] } {
  const cases: CorpusCase[] = [], mixed: string[] = [], refusedEverywhere: CorpusCase[] = [];
  m3Rows().forEach((row, i) => {
    const requestId = m3RequestId(row), outcomes = M3_SEEDS.map(seed => outcome(requestId, seed)), id = `m3/${String(i).padStart(3, "0")}`;
    if (outcomes.every(o => o === "preview")) {
      cases.push({ id, text: row.text, population: m3Population(row), family: m3Family(row), cluster: `m3:${row.kind}:${row.cadence}`, tags: [],
        required: M3_SEEDS.map(seed => ({ seed, contextId: m3WorldId(seed), requestId, referenceId: m3ReferenceId(requestId, seed), requiresConsent: true })) });
    } else if (outcomes.every(o => o === "refused")) {
      refusedEverywhere.push({ id, text: row.text, population: "P-UNSAFE", family: m3Family(row), cluster: `m3:${row.kind}:${row.cadence}`, tags: ["reduction-too-large"],
        required: M3_SEEDS.map(seed => ({ seed, contextId: m3WorldId(seed), requestId: null, referenceId: null, stop: "refusal" as const })) });
    } else mixed.push(id);
  });
  return { cases, mixed, refusedEverywhere };
}

// ---- independent integer-cent calculator (the retained gold arithmetic, generalised from three months to the complete months the native read gives) ---------------------
const cents = (s: string): bigint => { const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s); if (!m) throw new Error(`not money: ${s}`); return BigInt(m[1] + m[2] + (m[3] ?? "").padEnd(2, "0")); };
const dollars = (c: bigint) => `${c < 0n ? "-" : ""}${(c < 0n ? -c : c) / 100n}.${String((c < 0n ? -c : c) % 100n).padStart(2, "0")}`;
const roundDiv = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);      // half up, non-negative
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type NativeMonth = { month: string; total: string; coverage: string };
export type M3Result = { outcome: "preview"; monthsUsed: number; usualMonth: string; totalSaving: string; months: { month: string; saved: string }[]; monthlyLimit: string | null } | { outcome: "refused"; monthsUsed: number };
export function m3ExpectedResult(intent: ReturnType<typeof m3Intent>, months: NativeMonth[]): M3Result {
  const used = months.filter(m => m.coverage === "complete"), count = BigInt(used.length);
  if (used.length === 0) throw new Error("no complete month: a manual baseline would be needed");
  const sum = used.reduce((s, m) => s + cents(m.total), 0n), usual = roundDiv(sum, count), n = intent.cadence === "once" ? 1 : 2;
  const monthNames = intent.cadence === "once" ? [] : ["November 2026", "December 2026"];
  if (intent.reduction.kind === "money") {
    const cut = cents(intent.reduction.amount);
    if (cut * count > sum) return { outcome: "refused", monthsUsed: used.length };
    return { outcome: "preview", monthsUsed: used.length, usualMonth: dollars(usual), totalSaving: dollars(cut * BigInt(n)), months: monthNames.map(month => ({ month, saved: dollars(cut) })), monthlyLimit: intent.cadence === "once" ? null : dollars(usual - cut) };
  }
  const p = cents(intent.reduction.amount);                                    // percent in hundredths of a percent
  const line = roundDiv(sum * p, count * 10000n), total = roundDiv(sum * p * BigInt(n), count * 10000n);
  return { outcome: "preview", monthsUsed: used.length, usualMonth: dollars(usual), totalSaving: dollars(total), months: monthNames.map(month => ({ month, saved: dollars(line) })), monthlyLimit: dollars(usual - line) };
}
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
