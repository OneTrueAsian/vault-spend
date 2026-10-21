import { readFileSync } from "node:fs";

/**
 * VP-07 / CG-03: the complete, authority-backed list of gated families. Test-only. The grader reports every family in this file, including
 * those with zero cases, and rejects a caller-supplied list that differs from it. It is deliberately NOT derived from cases.json.
 */
export type Outcome = "completion" | "clarification" | "refusal" | "numeric-boundary" | "routing";
export type RegisteredFamily = { id: string; milestone: string; authority: string; gate: string; population: string; applicability: string; outcomes: Outcome[]; outcomeAuthority: string };
const file = JSON.parse(readFileSync(`${__dirname}/requiredFamilies.json`, "utf8")) as { version: string; families: RegisteredFamily[] };
const ids = new Set(file.families.map(f => f.id));
export const REQUIRED_FAMILY_REGISTRY_VERSION = file.version;
export const REQUIRED_FAMILIES: readonly RegisteredFamily[] = file.families;
export const REQUIRED_FAMILY_IDS: readonly string[] = file.families.map(f => f.id);

/** Problems with a caller's list, relative to the registry. Empty when it is exactly the registry (order is immaterial). */
export function requiredFamilyProblems(list: readonly string[]): string[] {
  const problems: string[] = [];
  const counts = new Map<string, number>();
  for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) if (n > 1) problems.push(`required-family list repeats ${id}`);
  for (const id of counts.keys()) if (!REQUIRED_FAMILY_IDS.includes(id)) problems.push(`required-family list names unknown family ${id}`);
  for (const id of REQUIRED_FAMILY_IDS) if (!counts.has(id)) problems.push(`required-family list omits ${id}`);
  return problems;
}

/**
 * Owner decision Q2: `m2:m1:X` is the M1 family `m1:X` re-run under the M2 acceptance, mapped only where the capability and counting obligations are unchanged (same gate, same
 * population, no second count of the same text), and `m2:m1:comparison-threshold` is `m2:comparison-threshold`. An id with no registered target is NOT silently mapped (null).
 * A registered id maps to itself.
 */
export function crosswalkFamily(id: string): string | null {
  if (ids.has(id)) return id;
  if (id === "m2:m1:comparison-threshold") return "m2:comparison-threshold";
  const m = /^m2:m1:(.+)$/.exec(id);
  if (!m) return null;
  const target = file.families.find(f => f.id === `m1:${m[1]}`), source = file.families.find(f => f.id === id);
  return target && (!source || (source.gate === target.gate && source.population === target.population)) ? target.id : null;
}
