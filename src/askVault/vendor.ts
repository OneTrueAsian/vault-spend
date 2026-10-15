/**
 * Store and payee lookup. A "vendor" is whatever the bank wrote on the transaction, so the typed name is
 * matched against descriptions with the same rule the native read uses (core/src/store/ask_vault.rs
 * `vendor_term` / `vendor_matches`). Keep the two in step: vendor.test.ts and the Rust tests share a table.
 */
import { distance } from "./distance";
const MAX_TERM_CHARS = 64;
const MAX_TERM_WORDS = 6;
const MAX_SUGGESTIONS = 3;

/** Lowercase words. Apostrophes vanish ("Sam's" is "sams"); anything else that is not a letter or digit splits words. */
export function vendorWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/** The term with its spaces removed, or null when empty, a single character, or too long. */
export function vendorTerm(raw: string): string | null {
  if ([...raw].length > MAX_TERM_CHARS) return null;
  const words = vendorWords(raw);
  const term = words.join("");
  return [...term].length >= 2 && words.length <= MAX_TERM_WORDS ? term : null;
}

/** A description matches when the term starts at the beginning of any of its words, read together. */
export function vendorMatches(description: string, term: string): boolean {
  const words = vendorWords(description);
  return words.some((_, i) => words.slice(i).join("").startsWith(term));
}

/** The recorded names with repeats collapsed and each split into words once, kept for as long as the same list is used. */
type Prepared = { names: string[]; counts: Map<string, number>; words: Map<string, string[]> };
const prepared = new WeakMap<readonly string[], Prepared>();
function prepare(descriptions: readonly string[]): Prepared {
  const known = prepared.get(descriptions);
  if (known) return known;
  const counts = new Map<string, number>();
  for (const d of descriptions) counts.set(d, (counts.get(d) ?? 0) + 1);
  const names = [...counts.keys()];
  const words = new Map(names.map((name) => [name, vendorWords(name)]));
  const made = { names, counts, words };
  prepared.set(descriptions, made);
  return made;
}
const startsAtAWord = (words: string[], term: string) => words.some((_, i) => words.slice(i).join("").startsWith(term));

/** True when any recorded name matches the term (the same rule as vendorMatches, without redoing the word split). */
export function anyVendorMatches(descriptions: readonly string[], term: string): boolean {
  const { names, words } = prepare(descriptions);
  return names.some((name) => startsAtAWord(words.get(name)!, term));
}

export type VendorChoice = { label: string; term: string };
export type VendorResolution =
  | { status: "matched"; term: string; names: string[] }
  | { status: "ambiguous"; choices: VendorChoice[]; bothTerm: string }
  | { status: "none"; suggestions: VendorChoice[] };

/** The shared look of one store's descriptions: words before the first one holding a digit (a store number). */
function brandLabel(description: string): VendorChoice {
  const words = vendorWords(description);
  const end = words.findIndex((w) => /\d/.test(w));
  const lead = (end > 0 ? words.slice(0, end) : words).slice(0, MAX_TERM_WORDS);
  return { label: lead.join(" ").toUpperCase(), term: lead.join(" ") };
}

type Group = { first: string; names: string[] };

/** Descriptions are one store when their first words are equal or one starts the other ("sams" and "samsclub"). */
function groupByBrand(names: string[]): Group[] {
  const groups: Group[] = [];
  for (const name of names) {
    const first = vendorWords(name)[0] ?? name.toLowerCase();
    const home = groups.find((g) => g.first.startsWith(first) || first.startsWith(g.first));
    if (home) {
      home.names.push(name);
      if (first.length < home.first.length) home.first = first;
    } else groups.push({ first, names: [name] });
  }
  return groups;
}

function mostCommon(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function choiceFor(group: Group): VendorChoice {
  return brandLabel(mostCommon(group.names));
}

/**
 * Decide what a typed store name refers to, using the descriptions the Dashboard already has.
 * With `wholeWords`, each typed word must be a whole word of the name (used when no "at" marks it as a store).
 * `descriptions` may repeat (one entry per transaction); repeats make the commonest name the label.
 */
export function resolveVendor(typed: string, descriptions: string[], wholeWords = false): VendorResolution {
  const term = vendorTerm(typed);
  if (term === null) return { status: "none", suggestions: [] };
  const typedWords = vendorWords(typed);
  const { names, counts, words: nameWords } = prepare(descriptions);
  const wholeWordMatch = (words: string[]) => words.some((_, i) => typedWords.every((w, k) => words[i + k] === w));
  // Repeats are kept (the commonest spelling labels a store), but each distinct name is matched once.
  const matched = names
    .filter((name) => startsAtAWord(nameWords.get(name)!, term) && (!wholeWords || wholeWordMatch(nameWords.get(name)!)))
    .flatMap((name) => Array<string>(counts.get(name)!).fill(name));
  if (wholeWords && matched.length === 0) return { status: "none", suggestions: [] };
  if (matched.length > 0) {
    const groups = groupByBrand(matched);
    if (groups.length === 1) return { status: "matched", term: vendorWords(typed).join(" "), names: [...new Set(matched)] };
    const choices = groups.map(choiceFor).sort((a, b) => a.label.localeCompare(b.label));
    return { status: "ambiguous", choices, bothTerm: vendorWords(typed).join(" ") };
  }
  const first = vendorWords(typed)[0];
  const tolerance = first.length <= 5 ? 1 : 2;
  const close = groupByBrand(
    names
      .filter((name) => {
        const word = nameWords.get(name)![0];
        return word !== undefined && first.length >= 3 && distance(first, word.slice(0, first.length + 1)) <= tolerance;
      })
      .flatMap((name) => Array<string>(counts.get(name)!).fill(name)),
  );
  return { status: "none", suggestions: close.slice(0, MAX_SUGGESTIONS).map(choiceFor) };
}
