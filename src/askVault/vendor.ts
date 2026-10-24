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
type Prepared = { names: string[]; counts: Map<string, number>; words: Map<string, string[]>; lists: string[][]; starts?: Map<string, number[]> };
const prepared = new WeakMap<readonly string[], Prepared>();
function prepare(descriptions: readonly string[]): Prepared {
  const known = prepared.get(descriptions);
  if (known) return known;
  const counts = new Map<string, number>();
  for (const d of descriptions) counts.set(d, (counts.get(d) ?? 0) + 1);
  const names = [...counts.keys()];
  const lists = names.map((name) => vendorWords(name)), words = new Map(names.map((name, n) => [name, lists[n]]));
  const made: Prepared = { names, counts, words, lists };
  prepared.set(descriptions, made);
  return made;
}
const startsAtAWord = (words: string[], term: string) => words.some((_, i) => words.slice(i).join("").startsWith(term));

/** True when any recorded name matches the term (the same rule as vendorMatches, without redoing the word split). */
export function anyVendorMatches(descriptions: readonly string[], term: string): boolean {
  const prepared = prepare(descriptions), near = candidates(prepared, term);
  return near === null ? prepared.lists.some((words) => startsAtAWord(words, term)) : near.some((n) => startsAtAWord(prepared.lists[n], term));
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

function mostCommon(names: string[], counts: ReadonlyMap<string, number>): string {
  return [...names].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b))[0];
}

function choiceFor(group: Group, counts: ReadonlyMap<string, number>): VendorChoice {
  return brandLabel(mostCommon(group.names, counts));
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
  const prepared = prepare(descriptions), { names, counts, words: nameWords } = prepared;
  const wholeWordMatch = (words: string[]) => words.some((_, i) => typedWords.every((w, k) => words[i + k] === w));
  // Match and group each spelling once. Keep its frequency as a weight for the label, rather than
  // expanding tens of thousands of repeated descriptions and tokenizing every purchase again.
  const matched = (candidates(prepared, term)?.map((n) => names[n]) ?? names)
    .filter((name) => startsAtAWord(nameWords.get(name)!, term) && (!wholeWords || wholeWordMatch(nameWords.get(name)!)));
  if (wholeWords && matched.length === 0) return { status: "none", suggestions: [] };
  if (matched.length > 0) {
    const groups = groupByBrand(matched);
    if (groups.length === 1) return { status: "matched", term: vendorWords(typed).join(" "), names: matched };
    const choices = groups.map(group => choiceFor(group, counts)).sort((a, b) => a.label.localeCompare(b.label));
    return { status: "ambiguous", choices, bothTerm: vendorWords(typed).join(" ") };
  }
  const first = vendorWords(typed)[0], measured = new Map<string, boolean>(); // each distinct first word is measured once, not each of thousands of names
  const tolerance = first.length <= 5 ? 1 : 2;
  const close = groupByBrand(
    names
      .filter((name) => {
        const word = nameWords.get(name)![0];
        return word !== undefined && first.length >= 3 && (measured.get(word) ?? (measured.set(word, distance(first, word.slice(0, first.length + 1), tolerance) <= tolerance), measured.get(word)));
      }),
  );
  return { status: "none", suggestions: close.slice(0, MAX_SUGGESTIONS).map(group => choiceFor(group, counts)) };
}

/**
 * The names a term could match, as positions in `names` in their original order. A term of two or more characters can only match a name that
 * has a place (a word, read together with the words after it) beginning with the term's first two characters, so only those names are tested
 * with the full rule. Built once per list, the first time it is needed. A shorter term has no such place to look up, so every name stays a candidate.
 */
function candidates(prepared: Prepared, term: string): readonly number[] | null {
  if (term.length < 2) return null;
  if (!prepared.starts) {
    const starts = new Map<string, number[]>();
    prepared.lists.forEach((words, n) => {
      for (let i = 0; i < words.length; i++) {
        const key = (words[i] + (words[i + 1] ?? "")).slice(0, 2);
        if (key.length < 2) continue;
        const bucket = starts.get(key);
        if (!bucket) starts.set(key, [n]);
        else if (bucket[bucket.length - 1] !== n) bucket.push(n);
      }
    });
    prepared.starts = starts;
  }
  return prepared.starts.get(term.slice(0, 2)) ?? [];
}

/** Prepare a loaded roster before submission, yielding between bounded slices. Partial/cancelled caches are never published. */
export async function prepareVendors(descriptions: readonly string[], signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  if (prepared.has(descriptions)) return true;
  const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  await yieldTask();
  const slice = async <T,>(items: Iterable<T>, visit: (item: T) => void): Promise<boolean> => {
    let deadline = performance.now() + 4;
    for (const item of items) {
      if (signal.aborted) return false;
      visit(item);
      if (performance.now() >= deadline) { await yieldTask(); deadline = performance.now() + 4; }
    }
    return !signal.aborted;
  };
  const counts = new Map<string, number>();
  if (!await slice(descriptions, d => counts.set(d, (counts.get(d) ?? 0) + 1))) return false;
  const names: string[] = [], lists: string[][] = [], words = new Map<string, string[]>(), starts = new Map<string, number[]>();
  if (!await slice(counts.keys(), name => { const tokens = vendorWords(name); names.push(name); lists.push(tokens); words.set(name, tokens); })) return false;
  if (!await slice(lists.entries(), ([n, tokens]) => {
    for (let i = 0; i < tokens.length; i++) {
      const key = (tokens[i] + (tokens[i + 1] ?? "")).slice(0, 2);
      if (key.length < 2) continue;
      const bucket = starts.get(key);
      if (!bucket) starts.set(key, [n]);
      else if (bucket[bucket.length - 1] !== n) bucket.push(n);
    }
  })) return false;
  if (signal.aborted) return false;
  if (!prepared.has(descriptions)) prepared.set(descriptions, { names, counts, words, lists, starts });
  return true;
}
