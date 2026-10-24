import { distance } from "../../askVault/distance";

/**
 * Independent restatement of the EXISTING bounded matching rules, per entity class (owner decision Q1, 21 October 2026). Test-only. It enumerates the permitted
 * candidates for a typed clause on a roster so flagged cases can be frozen with their candidates BEFORE grading. It does not decide anything the app decides:
 * the app's live choices are compared with these candidates in typoDispositions.test.tsx. The rules are recorded, with source lines, in typoRules.json.
 * No universal edit distance or margin exists, and none is introduced here: each class keeps its own bound.
 */
export type Roster = { categories: string[]; accounts: { name: string }[]; members: string[]; merchants: string[] };
const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Ordinary entities (categories, accounts, family members): src/askVault/parser.ts:239-262 (fuzzyMatches) and :805-822 (the decision). */
export function ordinaryCandidates(typed: string, roster: Roster): string[] {
  const tokens = words(typed);
  const names = [...roster.categories, ...roster.accounts.map(a => a.name), ...roster.members];
  const out = new Set<string>();
  for (const name of names) {
    const parts = words(name);
    if (tokens.length > 1) { if (tokens.join(" ").length >= 3 && distance(tokens.join(" "), parts.join(" "), 1) <= 1) out.add(name); continue; }
    const w = tokens[0], first = parts[0];
    const accountName = roster.accounts.some(a => a.name === name);
    if (w.length >= 3 && /^\p{L}+$/u.test(w) && (first.startsWith(w) || distance(w, first, 1) <= 1)) out.add(name);
    else if (accountName && w.length >= 5 && parts.includes(w)) out.add(name);
  }
  return [...out].sort();
}

/** A recorded description as the words of its name, cut at the first word with a digit (parser.ts recordedName; vendor.ts prepare). */
export const brandOf = (description: string): string => {
  const w = description.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  const end = w.findIndex(x => /\d/.test(x));
  return (end > 0 ? w.slice(0, end) : w).join(" ");
};

/** Stores: src/askVault/vendor.ts:100-127 (resolveVendor). A typed name that starts a recorded name is a match; otherwise at most three close first words are offered. */
export function storeCandidates(typed: string, roster: Roster): { matched: string[]; suggestions: string[] } {
  const typedWords = typed.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  const brands = [...new Set(roster.merchants.map(brandOf))].sort();
  const prefix = brands.filter(b => b.split(" ").some((_, i, all) => typedWords.every((t, k) => k === typedWords.length - 1 ? (all[i + k] ?? "").startsWith(t) : all[i + k] === t)));
  if (prefix.length) return { matched: prefix, suggestions: [] };
  const first = typedWords[0], tolerance = first.length <= 5 ? 1 : 2;
  const close = brands.filter(b => { const w0 = b.split(" ")[0]; return first.length >= 3 && distance(first, w0.slice(0, first.length + 1), tolerance) <= tolerance; });
  return { matched: [], suggestions: close.slice(0, 3) };
}

/** Investment accounts: src/askVault/retirementParser.ts:134 (close names) with that file's own plain edit distance, no alias, no transposition. */
export function investmentAccountCandidates(typed: string, accounts: { name: string }[]): string[] {
  const norm = (s: string) => s.normalize("NFC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
  const lev = (a: string, b: string) => { const x = Array.from(norm(a)), y = Array.from(norm(b)); let row = y.map((_, i) => i + 1); row.unshift(0); for (let i = 0; i < x.length; i++) { const next = [i + 1]; for (let j = 0; j < y.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(x[i] !== y[j]))); row = next; } return row[y.length]; };
  return accounts.filter(a => Math.abs(a.name.length - typed.length) <= 2 && lev(a.name, typed) <= (typed.length >= 8 ? 2 : 1)).slice(0, 3).map(a => a.name);
}
