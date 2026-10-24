import { alignedPrior, daysInMonth, isoDate, monthsTouching } from "./calendar";
import { dayLabel, matchPeriod, MONTHS, tokenize } from "./dates";
import { distance } from "./distance";
import { anyVendorMatches, resolveVendor, vendorTerm, vendorWords } from "./vendor";
import type {
  AskAccount,
  AskAlignment,
  AskAverageKind,
  AskFamilyMember,
  AskMemberSelection,
  AskGroupBy,
  AskVaultRequest,
  AskVaultRequestV2,
  Correction,
  Interpretation,
  ParseContext,
  ParseOutcome,
  ResolvedPeriod,
} from "./types";

/**
 * Handwritten clause parser for spending questions. It turns words into a typed request for the native
 * read, or says plainly why it cannot. Rules it never breaks:
 *  - every word is accounted for; an unknown word means "I don't understand", never a smaller question;
 *  - numbers, negation and before/after/without are never corrected or dropped;
 *  - names that are close to two choices ask which one.
 */
const MAX_QUESTION_CHARS = 512;
const MAX_LIMIT = 50;

type Atom =
  | { kind: "category"; text: string; name: string; excluded?: boolean }
  | { kind: "account"; text: string; account: AskAccount; excluded?: boolean }
  | { kind: "legacy-entity"; text: string; excluded?: boolean }
  | { kind: "vendor"; text: string; label: string; term: string; excluded?: boolean }
  | { kind: "exclude"; text: string }
  /** Version 2: a family member chosen by exact name. */
  | { kind: "member"; text: string; id: number; name: string; excluded?: boolean }
  | { kind: "unassigned" | "by-member" | "average"; text: string }
  /** "monthly", "by month": a month-by-month breakdown, or with "average" the cadence of the average. `group` is true for "by month". */
  | { kind: "monthly"; text: string; group: boolean }
  | { kind: "other-cadence"; text: string; unit: "day" | "week" | "quarter" | "year" }
  | { kind: "same-days"; text: string; alignment: Exclude<AskAlignment, "as-requested">; month?: number }
  | { kind: "period"; text: string; period: ResolvedPeriod }
  | { kind: "threshold"; text: string; amount: string; inclusive: boolean }
  | { kind: "number"; text: string; value: number }
  | { kind: "spend" | "total" | "rank" | "compare" | "join" | "plural-categories" | "singular-category" | "purchase" | "legacy" | "filler" | "unknown"; text: string };

const SPEND = new Set(["spend", "spends", "spent", "spending", "paid", "pay", "paying", "cost", "costs"]);
const TOTAL = new Set(["total", "totals", "sum", "totalled"]);
const RANK = new Set(["top", "rank", "ranked", "biggest", "largest", "highest", "most", "costliest", "priciest"]);
const COMPARE = new Set(["compare", "compared", "comparison", "difference", "versus", "vs", "more", "than"]);
const JOIN = new Set(["to", "with", "and", "or"]);
const EXCLUDERS = new Set(["without", "except", "excluding", "exclude", "besides", "minus"]);
const MAX_STORES = 10;
const PURCHASE = new Set(["purchase", "purchases", "expense", "expenses", "transaction", "transactions", "charge", "charges"]);
const FILLER = new Set(
  ("how much did do does i my me on in for the please show what whats what's was were is are have has by money tell of from at about " +
    "using a an all only just so far could would can you give get see list find that it its anything everything single each overall altogether exactly account accounts which").split(" "),
);
const LEGACY_WORDS = new Set([
  "net", "worth", "networth", "debt", "debts", "owe", "owed", "balance", "balances", "subscription", "subscriptions",
  "bill", "bills", "saved", "toward", "towards", "runway", "savings", "income", "earn", "earned", "earning", "paycheck",
  "salary", "average", "avg", "many", "count", "number", "cash",
]);
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WORD_TYPOS: Record<string, string> = {
  spnt: "spent", spnd: "spend", spnet: "spent", spendin: "spending", toal: "total", totla: "total", comapre: "compare",
  catagories: "categories", categorys: "categories", catergories: "categories", catagory: "category",
};
/**
 * Words whose misspelling may be corrected (and shown). Negation, scope, amount, command, forecast and older-family
 * words are deliberately absent: they are never guessed at, and a word close to one of them is never corrected.
 */
const CORRECTABLE = [
  ...SPEND, ...TOTAL, ...RANK, ...PURCHASE, ...MONTHS, "categories", "category", "compare", "comparison", "versus", "altogether",
  "yesterday", "quarter", "month", "months", "week", "weeks", "year", "years", "since", "past", "spending", "everything", "whats",
];
const NEVER_GUESSED = [
  "not", "without", "except", "excluding", "exclude", "besides", "minus", "but", "before", "after", "over", "above", "under", "below",
  "exceeding", "least", "greater", "larger", "bigger", "higher", "less", "cheaper", "between", "other",
];
function correctedWord(word: string): string | null {
  if (!/^\p{L}+$/u.test(word) || word.length < 4) return null;
  // A word the grammar already knows is never replaced by another one (which also keeps the scan from looping),
  // and a command, forecast, older-family or leaving-out word is taken at its word, never read as a misspelling.
  if (CORRECTABLE.includes(word) || CHANGES.has(word) || FORECAST.has(word) || LEGACY_WORDS.has(word) || INCOME.has(word) || NEGATION.has(word) || EXCLUDERS.has(word) || FILLER.has(word)) return null;
  if (NEVER_GUESSED.some((w) => w.length >= 4 && distance(word, w) <= 1)) return null;
  // Close to more than one known word ("mach": march or much), it is not guessed.
  const known = [...new Set([...CORRECTABLE, ...FILLER].filter((w) => w.length >= 4 && w !== word && distance(word, w) <= 1))];
  return known.length === 1 && CORRECTABLE.includes(known[0]) && (word.length >= 5 || known[0].length >= 5) ? known[0] : null;
}

const STRICT_OVER: string[][] = [["over"], ["above"], ["exceeding"], ["more", "than"], ["greater", "than"], ["larger", "than"], ["bigger", "than"], ["higher", "than"]];
const INCLUSIVE_OVER: string[][] = [["at", "least"], ["no", "less", "than"]];
const UNDER: string[][] = [["under"], ["below"], ["less", "than"], ["at", "most"], ["cheaper", "than"]];
const RESERVED_START = new Set(["not", "without", "except", "excluding", "after", "before", "delete", "remove", "last", "this", "past", "since", "from", "today", "yesterday", "the", "top"]);
const NEGATION = new Set(["not", "without", "except", "excluding", "exclude", "besides", "minus", "but"]);
const INCOME = new Set(["income", "earn", "earned", "earning", "earnings", "paycheck", "salary", "wage", "wages"]);
const FORECAST = new Set(["will", "would", "going", "forecast", "predict", "future", "projected"]);
const CHANGES = new Set(["delete", "remove", "transfer", "export", "set", "add", "create", "change", "move", "update", "rename", "send", "email"]);

const PUNCTUATION = new Set([",", "?", "!", ".", ":", "-", "—"]);
/** Polite words that may open or close a question. They are only ever removed from the two ends, never from the middle. */
const OPENERS: string[][] = [
  ["hey"], ["hi"], ["hello"], ["okay", "so"], ["ok", "so"], ["okay"], ["ok"], ["so"], ["quick", "question"], ["just", "curious"],
  ["i", "was", "wondering"], ["i", "am", "wondering"], ["i'm", "wondering"], ["i", "was", "curious"], ["i", "need", "to", "know"], ["i", "want", "to", "know"],
  ["i'm", "trying", "to", "figure", "this", "out"], ["i", "am", "trying", "to", "figure", "this", "out"], ["i'm", "trying", "to", "figure", "it", "out"],
  ["would", "you", "mind", "telling", "me"], ["could", "you", "please", "tell", "me"], ["for", "my", "records"], ["for", "the", "record"],
];
const CLOSERS: string[][] = [
  ["thanks"], ["thank", "you"], ["thx"], ["please"], ["when", "you", "get", "a", "chance"], ["if", "you", "can"], ["for", "me"], ["thanks", "a", "lot"],
];
function stripBookends(tokens: string[]): string[] {
  let out = tokens;
  for (let changed = true; changed; ) {
    changed = false;
    if (out.length && PUNCTUATION.has(out[0])) { out = out.slice(1); changed = true; }
    if (out.length && PUNCTUATION.has(out[out.length - 1])) { out = out.slice(0, -1); changed = true; }
    const opener = OPENERS.find((p) => p.length < out.length && p.every((word, k) => out[k] === word));
    if (opener) { out = out.slice(opener.length); changed = true; }
    const closer = CLOSERS.find((p) => p.length < out.length && p.every((word, k) => out[out.length - p.length + k] === word));
    if (closer) { out = out.slice(0, out.length - closer.length); changed = true; }
  }
  return out;
}

const unsupported = (reason: string): ParseOutcome => ({ status: "unsupported", reason });
const clarify = (reason: string, choices: string[] = [], replacements?: string[]): ParseOutcome =>
  replacements ? { status: "clarify", reason, choices, replacements } : { status: "clarify", reason, choices };


function startsWithPhrase(tokens: string[], i: number, phrase: string[]): boolean {
  return phrase.every((word, k) => tokens[i + k] === word);
}

function normalizeAmount(token: string): string | null {
  const m = /^\$?(\d+)(?:\.(\d+))?$/.exec(token);
  if (!m) return null;
  return `${m[1]}.${(m[2] ?? "").padEnd(2, "0")}`;
}

// ---- Version 2 words. They only apply when the Dashboard supplies `familyMembers`; without it the parser behaves exactly as in M1.
const BY_MEMBER: string[][] = [
  ["by", "family", "member"], ["by", "family", "members"], ["each", "family", "member"], ["every", "family", "member"], ["per", "family", "member"],
  ["for", "each", "family", "member"], ["by", "member"], ["per", "member"], ["each", "member"], ["family", "member"], ["family", "members"],
];
const UNASSIGNED: string[][] = [
  ["not", "assigned", "to", "a", "family", "member"], ["not", "assigned", "to", "any", "family", "member"], ["not", "assigned", "to", "anyone"],
  ["not", "assigned", "to", "anybody"], ["with", "no", "family", "member"], ["without", "a", "family", "member"], ["not", "assigned"], ["unassigned"],
];
const MONTHLY: { phrase: string[]; group: boolean }[] = [
  { phrase: ["month", "by", "month"], group: true }, { phrase: ["by", "month"], group: true }, { phrase: ["monthly"], group: false },
  { phrase: ["per", "month"], group: false }, { phrase: ["each", "month"], group: false }, { phrase: ["a", "month"], group: false },
];
const OTHER_CADENCE: { phrase: string[]; unit: "day" | "week" | "quarter" | "year" }[] = [
  { phrase: ["by", "quarter"], unit: "quarter" }, { phrase: ["quarterly"], unit: "quarter" }, { phrase: ["per", "quarter"], unit: "quarter" },
  { phrase: ["by", "week"], unit: "week" }, { phrase: ["weekly"], unit: "week" }, { phrase: ["per", "week"], unit: "week" }, { phrase: ["a", "week"], unit: "week" },
  { phrase: ["by", "day"], unit: "day" }, { phrase: ["daily"], unit: "day" }, { phrase: ["per", "day"], unit: "day" }, { phrase: ["a", "day"], unit: "day" },
  { phrase: ["by", "year"], unit: "year" }, { phrase: ["yearly"], unit: "year" }, { phrase: ["per", "year"], unit: "year" },
];
const AVERAGE: string[][] = [["on", "average"], ["average"], ["avg"], ["averages"]];
/** The questions a clarification can be asked about when no time period was given yet: each choice then also names one, so it can be answered. */
const PERIOD_CHOICES: [label: string, word: string][] = [["last month", "last month"], ["this month so far", "this month"], ["this year so far", "this year"]];
type Option = { label: string; question: string };
const SAME_NOUNS = new Set(["days", "day", "point", "time", "dates", "stretch"]);

function phraseLength(tokens: string[], i: number, phrases: string[][]): number {
  return phrases.reduce((best, phrase) => (startsWithPhrase(tokens, i, phrase) && phrase.length > best ? phrase.length : best), 0);
}

/** The version 2 clause words at `i`: breakdowns, averages, "not assigned", and "the same days last month". */
function versionTwoPhrase(tokens: string[], i: number): { atom: Atom; consume: number } | null {
  const text = (n: number) => tokens.slice(i, i + n).join(" ");
  const unassigned = phraseLength(tokens, i, UNASSIGNED);
  if (unassigned) return { atom: { kind: "unassigned", text: text(unassigned) }, consume: unassigned };
  const byMember = phraseLength(tokens, i, BY_MEMBER);
  if (byMember) return { atom: { kind: "by-member", text: text(byMember) }, consume: byMember };
  const monthly = MONTHLY.filter((m) => startsWithPhrase(tokens, i, m.phrase)).sort((a, b) => b.phrase.length - a.phrase.length)[0];
  const cadence = OTHER_CADENCE.filter((c) => startsWithPhrase(tokens, i, c.phrase)).sort((a, b) => b.phrase.length - a.phrase.length)[0];
  // "a month" / "a week" / "a day" only mean a cadence right after an average ("average spending a month").
  const afterAverage = tokens.slice(0, i).some((t) => t === "average" || t === "avg" || t === "averages");
  if (monthly && (monthly.phrase[0] !== "a" || afterAverage)) return { atom: { kind: "monthly", text: text(monthly.phrase.length), group: monthly.group }, consume: monthly.phrase.length };
  if (cadence && (cadence.phrase[0] !== "a" || afterAverage)) return { atom: { kind: "other-cadence", text: text(cadence.phrase.length), unit: cadence.unit }, consume: cadence.phrase.length };
  const average = phraseLength(tokens, i, AVERAGE);
  if (average) return { atom: { kind: "average", text: text(average) }, consume: average };
  if (tokens[i] === "same" && SAME_NOUNS.has(tokens[i + 1] ?? "")) {
    const [a, b] = [tokens[i + 2], tokens[i + 3]];
    if (["last", "previous", "prior"].includes(a ?? "") && (b === "month" || b === "year")) {
      return { atom: { kind: "same-days", text: text(4), alignment: b === "month" ? "same-days-previous-month" : "same-days-previous-year" }, consume: 4 };
    }
    if (a === "in" && MONTHS.includes(b ?? "")) {
      return { atom: { kind: "same-days", text: text(4), alignment: "same-days-previous-month", month: MONTHS.indexOf(b) + 1 }, consume: 4 };
    }
    if (a === "a" && (b === "month" || b === "year") && tokens[i + 4] === "ago") {
      return { atom: { kind: "same-days", text: text(5), alignment: b === "month" ? "same-days-previous-month" : "same-days-previous-year" }, consume: 5 };
    }
  }
  return null;
}

/**
 * A recorded name split into the same words the question is split into, so a name with a hyphen, an apostrophe or a full stop
 * ("Mary-Jane", "O’Brien", "Dr. Lee") is matched exactly as it is typed. The sentinel keeps a trailing full stop.
 */
const nameTokens = (name: string): string[] => tokenize(`${name} x`).slice(0, -1);

/** The family member whose name starts at `i`, longest name first. */
function memberAt(tokens: string[], i: number, members: AskFamilyMember[]): { member: AskFamilyMember; length: number; alternatives?: AskFamilyMember[] } | null {
  const matching = members
    .map((member) => ({ member, parts: nameTokens(member.name) }))
    .filter(({ parts }) => parts.every((part, k) => tokens[i + k] === part))
    .sort((a, b) => b.parts.length - a.parts.length);
  const found = matching[0];
  if (!found) return null;
  // Two members whose names are the same once case and apostrophes are ignored cannot be told apart from the question.
  const alternatives = matching.filter(m => m.parts.length === found.parts.length).map(m => m.member);
  return { member: found.member, length: found.parts.length, ...(alternatives.length > 1 ? { alternatives } : {}) };
}

type Entity = { name: string; parts: string[]; kind: "category" | "account" | "legacy"; account?: AskAccount };

function buildEntities(context: ParseContext): Entity[] {
  const entities: Entity[] = [
    ...context.categories.map<Entity>((name) => ({ name, parts: nameTokens(name), kind: "category" })),
    ...context.accounts.map<Entity>((account) => ({ name: account.name, parts: nameTokens(account.name), kind: "account", account })),
    ...(context.familyMembers === undefined ? context.members ?? [] : []).map<Entity>((name) => ({ name, parts: nameTokens(name), kind: "legacy" })),
  ];
  return entities.sort((a, b) => b.parts.length - a.parts.length);
}

function entityAtom(entity: Entity, text: string): Atom {
  if (entity.kind === "category") return { kind: "category", text, name: entity.name };
  if (entity.kind === "account") return { kind: "account", text, account: entity.account! };
  return { kind: "legacy-entity", text };
}

/** Bounded fuzzy candidates for the word at `i`. Names that start with a reserved word must be quoted. */
function fuzzyMatches(tokens: string[], i: number, entities: Entity[]): { entity: Entity; consume: number; weak?: boolean }[] {
  const w = tokens[i];
  const found: { entity: Entity; consume: number; weak?: boolean }[] = [];
  // A slip in a spending word ("sent" for "spent") is one letter from a category such as Rent: never quietly read as that category.
  if (w.length >= 4 && !SPEND.has(w) && ["spend", "spent", "spends", "spending"].some((word) => distance(w, word, 1) <= 1)) return found;
  for (const entity of entities) {
    if (RESERVED_START.has(entity.parts[0])) continue;
    const phrase = tokens.slice(i, i + entity.parts.length).join(" ");
    if (phrase.length >= 3 && distance(phrase, entity.parts.join(" "), 1) <= 1) {
      found.push({ entity, consume: entity.parts.length });
      continue;
    }
    const first = entity.parts[0];
    const minimum = entity.kind === "legacy" ? 4 : 3;
    const singleWord = w.length >= minimum && /^\p{L}+$/u.test(w) && (first.startsWith(w) || distance(w, first, 1) <= 1);
    const anyPart = entity.kind === "account" && w.length >= 5 && entity.parts.includes(w);
    if (singleWord || anyPart) {
      let consume = 1;
      if (singleWord) while (consume < entity.parts.length && tokens[i + consume] === entity.parts[consume]) consume++;
      // A misspelled first word of a longer name, with the rest not typed, is only a guess.
      found.push({ entity, consume, weak: singleWord && !anyPart && !first.startsWith(w) && entity.parts.length > 1 && consume < entity.parts.length });
    }
  }
  return found;
}

const THRESHOLD_STARTS = new Set(["over", "above", "exceeding", "greater", "larger", "bigger", "higher", "under", "below", "less", "cheaper"]);

const titleCase = (words: string[]) => words.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

/** True for a word that belongs to the grammar rather than to a store's name. */
function isStructural(tokens: string[], j: number, context: ParseContext): boolean {
  const t = tokens[j];
  if (context.familyMembers !== undefined && versionTwoPhrase(tokens, j) !== null) return true;
  return (
    SPEND.has(t) || TOTAL.has(t) || RANK.has(t) || COMPARE.has(t) || JOIN.has(t) || PURCHASE.has(t) || FILLER.has(t) ||
    NEGATION.has(t) || CHANGES.has(t) || FORECAST.has(t) || THRESHOLD_STARTS.has(t) || INCOME.has(t) ||
    (t === "other" && tokens[j + 1] === "than") || t === "before" || t === "after" || t === "," || t === "categories" || t === "category" || /^\$?\d/.test(t) ||
    matchPeriod(tokens, j, context.today, context.historyStart) !== null
  );
}

/**
 * Turn the typed words (or one quoted name) into a store atom, or into the question to ask instead.
 * A quoted name is a decision already made, so it is never asked about again.
 */
function vendorAtom(tokens: string[], at: number, count: number, quoted: boolean, context: ParseContext, wholeWords = false): Atom | ParseOutcome {
  const descriptions = context.merchants ?? [];
  const raw = quoted ? tokens[at].slice(1, -1) : tokens.slice(at, at + count).join(" ");
  const term = vendorTerm(raw);
  if (term === null) return unsupported("Name a store or payee with at least two letters or digits.");
  const label = titleCase(raw.split(/\s+/));
  const words = raw.toLowerCase().replace(/['\u2019]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const rebuild = (choiceTerm: string) => [...tokens.slice(0, at), `"${choiceTerm}"`, ...tokens.slice(at + count)].join(" ");
  if (quoted) {
    if (anyVendorMatches(descriptions, term)) return { kind: "vendor", text: raw, label, term: words };
    return clarify(`I couldn't find a category, account, store or payee called "${raw}". Choose one of your categories or stores.`);
  }
  const resolution = resolveVendor(raw, descriptions, wholeWords);
  if (resolution.status === "matched") return { kind: "vendor", text: raw, label, term: resolution.term };
  if (resolution.status === "ambiguous") {
    const labels = resolution.choices.map((c) => c.label);
    return {
      status: "clarify",
      reason: `More than one store or payee starts with "${raw}". Which one did you mean? Nothing has been added up yet.`,
      choices: [...labels, "Both"],
      replacements: [...resolution.choices.map((c) => rebuild(c.term)), rebuild(resolution.bothTerm)],
    };
  }
  if (resolution.suggestions.length > 0) {
    return {
      status: "clarify",
      reason: `I couldn't find a store or payee called "${raw}". Did you mean one of these?`,
      choices: resolution.suggestions.map((c) => c.label),
      replacements: resolution.suggestions.map((c) => rebuild(c.term)),
    };
  }
  return unsupported(`I couldn't find a store or payee called "${raw}" in your transactions.`);
}

const MAX_STORE_WORDS = 10;

/** A recorded description as the words of its name: apostrophes dropped, cut at the first word with a digit (a store number). */
function recordedName(description: string): string[] {
  const words = description.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  const end = words.findIndex((w) => /\d/.test(w));
  return end > 0 ? words.slice(0, end) : words;
}

/**
 * The most words from `i` that spell, as whole words, a recorded store's name (up to ten), or 0. A name may contain words that
 * are otherwise grammar ("of", "the"), so a long name is one store filter, never several.
 */
function longestStore(tokens: string[], i: number, context: ParseContext): number {
  const merchants = context.merchants ?? [];
  if (merchants.length === 0) return 0;
  for (let n = Math.min(MAX_STORE_WORDS, tokens.length - i); n >= 1; n--) {
    const span = tokens.slice(i, i + n);
    if (span.some((t) => t.startsWith('"') || t === ",")) continue;
    if (resolveVendor(span.join(" "), merchants, true).status !== "none") return n;
  }
  return 0;
}

/**
 * How many words from `i` name a recorded store whose name contains a version 2 grammar word ("Monthly Market"); 0 when none does.
 * A name longer than the grammar phrase counts, so "monthly groceries" stays a request. A store named only by the grammar phrase
 * ("Monthly") counts after on/at/from (`cued`), or when nothing but a time period or the end follows it.
 */
function storeSpanAt(tokens: string[], i: number, context: ParseContext, cued: boolean): number {
  const merchants = context.merchants ?? [];
  if (context.familyMembers === undefined || merchants.length === 0) return 0;
  const phrase = versionTwoPhrase(tokens, i);
  if (!phrase) return 0;
  for (let n = Math.min(MAX_STORE_WORDS, tokens.length - i); n >= phrase.consume; n--) {
    const beyond = Array.from({ length: n - phrase.consume }, (_, k) => i + phrase.consume + k);
    if (beyond.some((k) => tokens[k].startsWith('"') || tokens[k] === ",")) continue;
    const typed = tokens.slice(i, i + n).join(" ");
    if (resolveVendor(typed, merchants, true).status === "none") continue;
    if (n > phrase.consume) return n;
    const whole = merchants.some((m) => recordedName(m).join(" ") === typed);
    const next = tokens[i + n];
    // Uncued, a lone word is only a question when it opens the question and nothing but a period follows it.
    if (whole && (cued || (i === 0 && (next === undefined || matchPeriod(tokens, i + n, context.today, context.historyStart) !== null)))) return n;
  }
  return 0;
}

/** A word the grammar does not know may still be a store: try it (and up to three words after it) against the names on record. */
function implicitVendor(tokens: string[], i: number, context: ParseContext, strict = true, listed = false): { atom: Atom; count: number } | ParseOutcome | null {
  if (isStructural(tokens, i, context) || (context.merchants ?? []).length === 0) return null;
  // A recorded name of several words (which may itself contain words like "of") is one store.
  const long = strict ? longestStore(tokens, i, context) : 0;
  if (long > 1) {
    const whole = vendorAtom(tokens, i, long, false, context, strict);
    return "status" in whole ? whole : { atom: whole, count: long };
  }
  for (let n = Math.min(4, tokens.length - i); n >= 1; n--) {
    if (Array.from({ length: n }, (_, k) => i + k).some((k) => isStructural(tokens, k, context))) continue;
    const raw = tokens.slice(i, i + n).join(" ");
    const resolution = resolveVendor(raw, context.merchants ?? [], strict);
    if (resolution.status === "none") { const slip = n > 1 && listed ? laterWordSlip(tokens, i, n, context) : null; if (slip) return slip; continue; }
    const found = vendorAtom(tokens, i, n, false, context, strict);
    return "status" in found ? found : { atom: found, count: n };
  }
  return null;
}

const hasPeriod = (tokens: string[], context: ParseContext) =>
  tokens.some((_, i) => matchPeriod(tokens, i, context.today, context.historyStart)?.kind === "period");

/** Choices for a question: with no time period in the question yet, every choice carries one too, so none leads to another question. */
function periodComplete(options: Option[], tokens: string[], context: ParseContext): { choices: string[]; replacements: string[] } {
  const all = hasPeriod(tokens, context) ? options : options.flatMap((o) => PERIOD_CHOICES.map(([label, word]) => ({ label: `${o.label}, ${label}`, question: `${o.question} ${word}` })));
  return { choices: all.map((o) => o.label), replacements: all.map((o) => o.question) };
}

const isJoin = (t: string | undefined) => t === "and" || t === "or" || t === ",";

/** Words after which a name is a thing (an account, category, date or store), never a person. */
const NOT_A_PERSON_AFTER = new Set(["on", "at", "in", "from", "with", "using", "via", "under", "over", "than"]);

/**
 * A name equal to a family member's. It is that person after "did", "does", "has", before a spending word ("sam spent", "robin
 * purchase"), or continuing a list of members. When the same name is also a month, an account or a category, the words around it
 * decide: after on/in/at it is the thing; with no clue it is a question. Alone, when a recorded store also starts with the name, it is
 * a question too. "other" means: not a person here, read it as the thing it also is.
 */
function memberAtom(
  tokens: string[],
  i: number,
  named: { member: AskFamilyMember; length: number },
  atoms: Atom[],
  context: ParseContext,
  people: AskFamilyMember[],
  excluding: boolean,
  entities: Entity[],
): Atom | ParseOutcome | "other" {
  const text = tokens.slice(i, i + named.length).join(" ");
  const atom: Atom = { kind: "member", text, id: named.member.id, name: named.member.name };
  let after = i + named.length;
  // Look past "and alex" / ", robin" to the word that follows the whole list of names.
  for (;;) {
    let next = after;
    while (isJoin(tokens[next])) next++;
    const further = next > after ? memberAt(tokens, next, people) : null;
    if (!further) break;
    after = next + further.length;
  }
  const previous = tokens[i - 1] ?? "";
  const lastNamed = [...atoms].reverse().find((a) => a.kind !== "join" && a.kind !== "filler");
  const continuesList = isJoin(tokens[i - 1]) && lastNamed?.kind === "member";
  const strong = ["did", "does", "do", "has", "had"].includes(previous) || SPEND.has(tokens[after] ?? "") || PURCHASE.has(tokens[after] ?? "") || continuesList;
  const weak = previous === "for" || previous === "of";
  if (strong) return atom;
  if (excluding) return atom;
  const monthWord = named.length === 1 && MONTHS.includes(tokens[i]);
  const thing = entities.find((e) => e.kind !== "legacy" && !RESERVED_START.has(e.parts[0]) && e.parts.length === named.length && e.parts.every((part, k) => tokens[i + k] === part));
  if (monthWord || thing) {
    if (monthWord || NOT_A_PERSON_AFTER.has(previous)) return "other";
    const kindWord = thing!.kind === "account" ? "an account" : "a category";
    const person = [...tokens.slice(0, i), "did", text, "spend", ...tokens.slice(i + named.length)].join(" ");
    const entity = [...tokens.slice(0, i), `"${text}"`, ...tokens.slice(i + named.length)].join(" ");
    const options: Option[] = [
      { label: `${named.member.name}, a family member`, question: person },
      { label: `${thing!.name}, ${kindWord}`, question: entity },
    ];
    return {
      status: "clarify",
      reason: `"${titleCase([text])}" is the name of a family member and also of ${kindWord}. Which one did you mean? Nothing has been added up yet.`,
      ...periodComplete(options, tokens, context),
    };
  }
  const store = resolveVendor(text, context.merchants ?? [], false);
  // After on/at/from the name is the store when one starts with it; only the stores are offered then, never the person.
  if (NOT_A_PERSON_AFTER.has(previous) && store.status !== "none") return vendorAtom(tokens, i, named.length, false, context);
  if (weak) return atom;
  if (store.status === "none") return atom;
  const storeChoices =
    store.status === "matched"
      ? [{ label: titleCase(vendorWordsOf(store.names[0])), term: vendorWordsOf(store.names[0]).join(" ") }]
      : store.choices.map((c) => ({ label: titleCase(c.label.toLowerCase().split(" ")), term: c.term }));
  const options: Option[] = [
    { label: `${named.member.name}, a family member`, question: [...tokens.slice(0, i), "did", text, "spend", ...tokens.slice(i + named.length)].join(" ") },
    ...storeChoices.map((choice) => ({ label: choice.label, question: [...tokens.slice(0, i), `"${choice.term}"`, ...tokens.slice(i + named.length)].join(" ") })),
  ];
  return {
    status: "clarify",
    reason: `"${titleCase([text])}" could be a family member or a store. Which one did you mean? Nothing has been added up yet.`,
    ...periodComplete(options, tokens, context),
  };
}

/** The words of a recorded description that name the store: those before the first one holding a digit (a store number). */
function vendorWordsOf(description: string): string[] {
  const words = description.toLowerCase().replace(/['\u2019]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  const end = words.findIndex((w) => /\d/.test(w));
  return (end > 0 ? words.slice(0, end) : words).slice(0, 6);
}

/** "How much did Taylor spend": a name after "did" and before a spending word that is nobody and no store is a stop, never a guess. */
function unknownMember(tokens: string[], i: number, context: ParseContext, people: AskFamilyMember[]): ParseOutcome | null {
  const w = tokens[i];
  if (!/^\p{L}{2,}$/u.test(w) || !["did", "does", "do", "has", "had"].includes(tokens[i - 1] ?? "")) return null;
  // The name may start a list ("taylor and sam spend"): look past the joined names to the spending word.
  let after = i + 1;
  while (isJoin(tokens[after]) && tokens[after + 1] !== undefined) after += 2;
  if (!SPEND.has(tokens[after] ?? "")) return null;
  if (isStructural(tokens, i, context) || resolveVendor(w, context.merchants ?? [], true).status !== "none") return null;
  if (people.length === 0) return unsupported("No family members are set up yet, so I can't tell whose spending to add up. Add your family members first, then ask again.");
  return unsupported(`There is no family member called ${titleCase([w])}. Your family members are ${listNames(people.map((m) => m.name))}.`);
}

/**
 * Categories or accounts whose names differ only in the apostrophe ("John's Card", "John’s Card") read the same once typed, so a
 * question that names one cannot say which: stop instead of choosing, quoted or not.
 */
function lookalikeNames(tokens: string[], entities: Entity[]): ParseOutcome | null {
  const groups = new Map<string, Entity[]>();
  for (const entity of entities) {
    if (entity.kind === "legacy") continue;
    const key = entity.parts.join(" ");
    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }
  for (const [key, group] of groups) {
    if (new Set(group.map((e) => e.name)).size < 2) continue;
    const parts = group[0].parts;
    const named = tokens.some(
      (t, i) => (t.startsWith('"') && nameTokens(t.slice(1, -1)).join(" ") === key) || (!t.startsWith('"') && parts.every((part, k) => tokens[i + k] === part)),
    );
    if (named) {
      const names = [...new Set(group.map((e) => `"${e.name}"`))];
      return unsupported(`Two of your names, ${listNames(names)}, look the same when typed, so I can't tell which one you mean. Rename one of them and ask again.`);
    }
  }
  return null;
}

function scan(tokens: string[], context: ParseContext, selected: AskMemberSelection[]): { atoms: Atom[]; corrections: Correction[] } | ParseOutcome {
  const entities = buildEntities(context);
  const lookalike = lookalikeNames(tokens, entities);
  if (lookalike) return lookalike;
  const people = context.familyMembers;
  const atoms: Atom[] = [];
  const corrections: Correction[] = [];
  const display = (from: number, count: number) => tokens.slice(from, from + count).join(" ");
  // "Without ..." marks the names that follow as things to leave out, until a period, amount or verb ends the list.
  let excluding = false;
  // After a store, further names in a list (", sams club and target") may be written without "at".
  let vendorList = false;
  const add = (atom: Atom) => {
    const named = atom.kind === "category" || atom.kind === "account" || atom.kind === "vendor" || atom.kind === "legacy-entity" || atom.kind === "member";
    if (named) atom = { ...atom, excluded: excluding } as Atom;
    if (["period", "threshold", "spend", "total", "rank", "compare"].includes(atom.kind)) excluding = false;
    vendorList = atom.kind === "vendor" ? true : atom.kind === "filler" || atom.kind === "join" ? vendorList : false;
    atoms.push(atom);
  };

  /** How many words from `at` are a slip for a recorded store (0 when none is close): the longest run wins. */
  const storeSuggestionSpan = (at: number): number => {
    for (let n = Math.min(3, tokens.length - at); n >= 1; n--) {
      const run = tokens.slice(at, at + n);
      if (run.some((_, k) => isStructural(tokens, at + k, context))) continue;
      const close = resolveVendor(run.join(" "), context.merchants ?? [], false);
      if (close.status === "none" && close.suggestions.length > 0) return n;
    }
    return 0;
  };

  for (let i = 0; i < tokens.length; ) {
    const w = tokens[i];

    if (w.startsWith('"')) {
      const name = nameTokens(w.slice(1, -1)).join(" ");
      const hit = entities.find((e) => e.parts.join(" ") === name);
      if (hit) {
        add(entityAtom(hit, w));
        i++;
        continue;
      }
      const quotedVendor = vendorAtom(tokens, i, 1, true, context);
      if ("status" in quotedVendor) return quotedVendor;
      add(quotedVendor);
      i++;
      continue;
    }

    if (people !== undefined) {
      const phrase = versionTwoPhrase(tokens, i);
      const span = phrase ? storeSpanAt(tokens, i, context, NOT_A_PERSON_AFTER.has(tokens[i - 1] ?? "")) : 0;
      if (phrase && span) {
        // "Monthly Market", "Average Joes": the words are the start of a recorded store's name. After on/at/from it is the store;
        // with no cue it could be a request followed by a shorter store name, so ask.
        if (NOT_A_PERSON_AFTER.has(tokens[i - 1] ?? "")) {
          const found = vendorAtom(tokens, i, span, false, context, true);
          if ("status" in found) return found;
          add(found);
          i += span;
          continue;
        }
        const storeWords = tokens.slice(i, i + span);
        const rest = tokens.slice(i + phrase.consume, i + span);
        const options: Option[] = [
          { label: titleCase(storeWords), question: [...tokens.slice(0, i), `"${storeWords.join(" ")}"`, ...tokens.slice(i + span)].join(" ") },
          rest.length > 0
            ? {
                label: `"${titleCase(tokens.slice(i, i + phrase.consume))}" as a request, then the store "${titleCase(rest)}"`,
                question: [...tokens.slice(0, i), ...tokens.slice(i, i + phrase.consume), "at", `"${rest.join(" ")}"`, ...tokens.slice(i + span)].join(" "),
              }
            : {
                label: `"${titleCase(storeWords)}" as a request, not a store`,
                question: ["spending", ...tokens].join(" "),
              },
        ];
        return {
          status: "clarify",
          reason: `"${titleCase(storeWords)}" is the name of a store, and "${titleCase(tokens.slice(i, i + phrase.consume))}" is also a word I understand. Which did you mean? Nothing has been added up yet.`,
          ...periodComplete(options, tokens, context),
        };
      }
      if (phrase) {
        add(phrase.atom);
        i += phrase.consume;
        continue;
      }
      // "over the past 6 months" reads as a period, not as an amount: "over" only means more-than before an amount.
      if (w === "over" && ["the", "past", "last", "this", "from"].includes(tokens[i + 1] ?? "")) {
        add({ kind: "filler", text: w });
        i++;
        continue;
      }
    }

    const excluder =
      EXCLUDERS.has(w) ? 1 : w === "but" && tokens[i + 1] === "not" ? 2 : w === "other" && tokens[i + 1] === "than" ? 2 : 0;
    if (excluder) {
      add({ kind: "exclude", text: display(i, excluder) });
      excluding = true;
      i += excluder;
      continue;
    }

    if (w === "at" && tokens[i + 1] !== "least" && tokens[i + 1] !== "most") {
      let j = i + 1;
      if (tokens[j] === "the") j++;
      let end = j;
      let quoted = false;
      if (tokens[j]?.startsWith('"')) {
        quoted = true;
        end = j + 1;
      } else if (storeSpanAt(tokens, j, context, true) || longestStore(tokens, j, context) > 1) {
        end = j + (storeSpanAt(tokens, j, context, true) || longestStore(tokens, j, context));
      } else {
        while (end < tokens.length && end - j < 5 && !isStructural(tokens, end, context)) end++;
      }
      if (end > j) {
        const found = vendorAtom(tokens, j, end - j, quoted, context);
        if ("status" in found) return found;
        add(found);
        i = end;
        continue;
      }
    }

    if (INCOME.has(w)) {
      add({ kind: "legacy", text: w });
      i++;
      continue;
    }

    if (people !== undefined) {
      let named = memberAt(tokens, i, people);
      let occurrence = 0;
      if (named?.alternatives) {
        const key = nameTokens(named.member.name).join(" ");
        occurrence = atoms.filter(atom => atom.kind === "member" && nameTokens(atom.name).join(" ") === key).length;
        const chosen = named.alternatives.find(member => selected.some(choice => choice.id === member.id && choice.occurrence === occurrence));
        if (chosen) named = { member: chosen, length: named.length };
      }
      // A longer category or account name that starts with the same words wins ("sam card").
      const longer = named && entities.some((e) => e.kind !== "legacy" && e.parts.length > named.length && e.parts.every((part, k) => tokens[i + k] === part));
      if (named && !longer) {
        const decided = memberAtom(tokens, i, named, atoms, context, people, excluding, entities);
        if (decided !== "other") {
          if ("status" in decided) return decided;
          if (named.alternatives) {
            if (named.alternatives.length > MAX_CHOICES || new Set(named.alternatives.map(m => m.name)).size !== named.alternatives.length)
              return unsupported("These family members cannot be distinguished by name. Give them distinct names and ask again.");
            return {
              status: "clarify",
              reason: "These family member names look alike. Whose spending do you mean?",
              choices: named.alternatives.map(member => `${member.name}${member.name.includes("’") ? " (curved apostrophe)" : member.name.includes("'") ? " (straight apostrophe)" : ""}`),
              replacements: named.alternatives.map(member => [...tokens.slice(0, i), member.name, ...tokens.slice(i + named.length)].join(" ")),
              memberSelections: named.alternatives.map(member => [...selected, { ...member, occurrence }]),
            };
          }
          add(decided);
          i += named.length;
          continue;
        }
      }
    }

    // A misspelled name of two or more words ("cash wallt") is that name, not its first word taken as something older.
    const spelled = fuzzyMatches(tokens, i, entities).filter((m) => m.consume > 1 && m.entity.kind !== "legacy");
    if (spelled.length) {
      const longest = Math.max(...spelled.map((m) => m.consume));
      const best = spelled.filter((m) => m.consume === longest);
      if (new Set(best.map((m) => m.entity.name)).size === 1) {
        const { entity, consume } = best[0];
        const text = display(i, consume);
        add(entityAtom(entity, text));
        if (text !== entity.parts.join(" ")) corrections.push({ from: text, to: entity.name });
        i += consume;
        continue;
      }
    }

    const exact = entities.find((e) => !RESERVED_START.has(e.parts[0]) && !MONTHS.includes(e.parts[0]) && e.parts.every((p, k) => tokens[i + k] === p));
    if (exact) {
      add(entityAtom(exact, display(i, exact.parts.length)));
      i += exact.parts.length;
      continue;
    }

    if (people !== undefined) {
      const stranger = unknownMember(tokens, i, context, people);
      if (stranger) return stranger;
    }

    const under = UNDER.find((p) => startsWithPhrase(tokens, i, p) && normalizeAmount(tokens[i + p.length] ?? "") !== null);
    if (under) return unsupported("I can only look for purchases over an amount, not under it.");
    const over = [...STRICT_OVER.map((p) => ({ p, inclusive: false })), ...INCLUSIVE_OVER.map((p) => ({ p, inclusive: true }))].find(
      ({ p }) => startsWithPhrase(tokens, i, p) && /^\$?\d/.test(tokens[i + p.length + (tokens[i + p.length] === "of" ? 1 : 0)] ?? ""),
    );
    if (over) {
      const at = i + over.p.length + (tokens[i + over.p.length] === "of" ? 1 : 0);
      const amount = normalizeAmount(tokens[at]);
      if (amount === null) return unsupported("Write the amount as dollars and cents, like $100 or $100.50.");
      if ((tokens[at].split(".")[1] ?? "").length > 2) return unsupported("Use at most two decimal places for an amount.");
      let used = at + 1 - i;
      if (["dollars", "dollar", "bucks"].includes(tokens[at + 1] ?? "")) used++;
      add({ kind: "threshold", text: display(i, used), amount, inclusive: over.inclusive });
      i += used;
      continue;
    }

    const period = matchPeriod(tokens, i, context.today, context.historyStart);
    if (period) {
      if (period.kind === "clarify") {
        const monthWord = MONTHS.includes(tokens[i]);
        const replacements = monthWord ? period.choices.map((choice) => [...tokens.slice(0, i), choice.toLowerCase(), ...tokens.slice(i + 1)].join(" ")) : undefined;
        return clarify(period.reason, period.choices, replacements);
      }
      if (period.kind === "unsupported") return unsupported(period.reason);
      add({ kind: "period", text: display(i, period.consumed), period: period.period });
      i += period.consumed;
      continue;
    }

    let kind: Atom["kind"] | undefined;
    if (SPEND.has(w)) kind = "spend";
    else if (TOTAL.has(w)) kind = "total";
    else if (RANK.has(w)) kind = "rank";
    else if (COMPARE.has(w)) kind = "compare";
    else if (JOIN.has(w)) kind = "join";
    else if (w === "categories") kind = "plural-categories";
    else if (w === "category") kind = "singular-category";
    else if (PURCHASE.has(w)) kind = "purchase";
    else if (FILLER.has(w) || [",", "?", "!", ".", ":"].includes(w) || (w === "between" && tokens[i - 1] === "difference")) kind = "filler";
    if (kind) {
      add({ kind, text: w } as Atom);
      i++;
      continue;
    }

    if (/^\d+$/.test(w) || NUMBER_WORDS[w] !== undefined) {
      add({ kind: "number", text: w, value: NUMBER_WORDS[w] ?? Number(w) });
      i++;
      continue;
    }

    const typo = WORD_TYPOS[w];
    if (typo) {
      corrections.push({ from: w, to: typo });
      tokens = [...tokens.slice(0, i), typo, ...tokens.slice(i + 1)];
      continue;
    }

    if (LEGACY_WORDS.has(w) && !(people !== undefined && (w === "average" || w === "avg"))) {
      add({ kind: "legacy", text: w });
      i++;
      continue;
    }

    if (vendorList || excluding) {
      const listed = implicitVendor(tokens, i, context, !vendorList, true);
      if (listed && "status" in listed) return listed;
      if (listed) {
        add(listed.atom);
        i += listed.count;
        continue;
      }
    }

    const all = fuzzyMatches(tokens, i, entities);
    const real = all.filter((m) => m.entity.kind !== "legacy");
    const pool = real.length ? real : all;
    const longest = pool.filter((m) => m.consume > 1);
    const candidates = longest.length ? longest : pool;
    const order = [...context.categories, ...context.accounts.map((a) => a.name), ...(context.members ?? [])];
    const names = [...new Set(candidates.map((m) => m.entity.name))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    // In a list of stores, a slip that is close to both a store and a category is a question, not a guess.
    if ((vendorList || excluding) && candidates.length > 0 && candidates.every((m) => display(i, m.consume) !== m.entity.parts.join(" ") && !m.entity.parts[0].startsWith(w))) {
      const span = storeSuggestionSpan(i);
      const stores = span > 0 ? vendorAtom(tokens, i, span, false, context) : null;
      if (stores && "status" in stores && stores.status === "clarify" && stores.replacements) {
        return {
          status: "clarify",
          reason: `I'm not sure what "${w}" is. Did you mean one of these?`,
          choices: [...stores.choices, ...names],
          replacements: [...stores.replacements, ...names.map((name) => [...tokens.slice(0, i), `"${name.toLowerCase()}"`, ...tokens.slice(i + 1)].join(" "))],
        };
      }
    }
    // Only a guess (a slip in the first word of a longer name): in a list of stores it is probably a store, otherwise ask.
    const guessOnly = candidates.length > 0 && candidates.every((m) => m.weak);
    if (guessOnly && !(vendorList || excluding)) {
      const replacements = names.map((name) => [...tokens.slice(0, i), `"${name.toLowerCase()}"`, ...tokens.slice(i + 1)].join(" "));
      return clarify(`I couldn't find a category, account or store called "${w}". Did you mean one of these?`, names, replacements);
    }
    if (names.length > 1) {
      const window = (name: string) => candidates.find((m) => m.entity.name === name)?.consume ?? 1;
      const replacements = names.map((name) => [...tokens.slice(0, i), `"${name.toLowerCase()}"`, ...tokens.slice(i + window(name))].join(" "));
      return clarify("Which one did you mean?", names, replacements);
    }
    if (!guessOnly && (candidates.length === 1 || names.length === 1)) {
      const { entity, consume } = candidates[0];
      const text = display(i, consume);
      add(entityAtom(entity, text));
      if (entity.kind !== "legacy" && text !== entity.parts.join(" ")) corrections.push({ from: text, to: entity.name });
      i += consume;
      continue;
    }

    const implicit = implicitVendor(tokens, i, context);
    if (implicit && "status" in implicit) return implicit;
    if (implicit) {
      add(implicit.atom);
      i += implicit.count;
      continue;
    }

    // In a list of stores, an unknown word is most likely another store: offer the close ones, or name it as not found.
    // A close store wins over a wording slip ("costcs" is Costco, not "costs").
    if ((vendorList || excluding) && /^\p{L}{3,}$/u.test(w) && !isStructural(tokens, i, context)) {
      const span = storeSuggestionSpan(i);
      if (span > 0 || correctedWord(w) === null) {
        const listed = vendorAtom(tokens, i, Math.max(span, 1), false, context);
        if ("status" in listed) return listed;
        add(listed);
        i += Math.max(span, 1);
        continue;
      }
    }

    // "this qurater", "the past 3 monnths": the slip is in the word after the one that opens the period.
    if (["this", "last", "past", "since"].includes(w)) {
      const at = [1, 2].find((k) => tokens[i + k] !== undefined && correctedWord(tokens[i + k]) !== null);
      if (at !== undefined) {
        const next = correctedWord(tokens[i + at])!;
        corrections.push({ from: tokens[i + at], to: next });
        tokens = [...tokens.slice(0, i + at), next, ...tokens.slice(i + at + 1)];
        continue;
      }
    }

    const fixed = corrections.length < 12 ? correctedWord(w) : null;
    if (fixed) {
      corrections.push({ from: w, to: fixed });
      tokens = [...tokens.slice(0, i), fixed, ...tokens.slice(i + 1)];
      continue;
    }

    add({ kind: "unknown", text: w });
    i++;
  }
  return { atoms, corrections };
}

function unknownReason(word: string): string {
  if (NEGATION.has(word)) return "I can't leave things out of a question yet. Ask about everything in a category, or name the one thing you want.";
  if (word === "before" || word === "after") return 'I can only use a start and an end date, like "from June 1 to June 30", not "before" or "after".';
  if (FORECAST.has(word)) return "I can only answer about money that has already been recorded. I can’t predict the future yet.";
  if (word === "share" || word === "portion" || word === "proportion" || word === "fraction") return "I can't work out a share or percent of your spending yet. Ask for the totals and I'll add them up.";
  if (word === "%" || word === "percentage" || word === "percent" || word === "discount") return "I can't work with percentages or discounts in a question yet.";
  if (CHANGES.has(word)) return "Asking a question can't change your data. Use the buttons in the app to make changes.";
  return `I don't understand "${word}" yet. Try a category name, a time period like "last month", or something like "top 3".`;
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

type Clarification = Extract<ParseOutcome, { status: "clarify" }>;
const MAX_CHOICES = 12;

/**
 * In the family-aware grammar a clarification is closed: a choice that would itself ask another question is replaced by that
 * question's own choices (labels joined), so tapping any choice gives an answer. Left as it is when that would be too many choices.
 */
function closeChoices(outcome: Clarification, context: ParseContext, selected: AskMemberSelection[], depth = 0): Clarification {
  if (!outcome.replacements || depth >= 3) return outcome;
  const choices: string[] = [];
  const replacements: string[] = [];
  const memberSelections: AskMemberSelection[][] = [];
  outcome.replacements.forEach((replacement, k) => {
    const bindings = outcome.memberSelections?.[k] ?? selected;
    const next = parseOnce(replacement, context, bindings);
    if (next.status === "clarify" && next.replacements?.length) {
      const inner = closeChoices(next, context, bindings, depth + 1);
      inner.choices.forEach((choice, n) => {
        choices.push(`${outcome.choices[k]}, ${choice}`);
        replacements.push(inner.replacements![n]);
        memberSelections.push(inner.memberSelections?.[n] ?? bindings);
      });
    } else {
      choices.push(outcome.choices[k]);
      replacements.push(replacement);
      memberSelections.push(bindings);
    }
  });
  return choices.length > MAX_CHOICES ? outcome : { ...outcome, choices, replacements, ...(memberSelections.some(m => m.length) ? { memberSelections } : {}) };
}

/**
 * Every choice offered must itself be a question that can be answered. A choice that would only lead to a stop is dropped; when no
 * choice is left, the question stops with the reason the choices would have given.
 */
function onlyAnswerable(outcome: Clarification, context: ParseContext, selected: AskMemberSelection[]): ParseOutcome {
  if (!outcome.replacements) return outcome;
  const kept: { choice: string; replacement: string; members: AskMemberSelection[] }[] = [];
  let stop: ParseOutcome | undefined;
  outcome.replacements.forEach((replacement, k) => {
    const members = outcome.memberSelections?.[k] ?? selected;
    const next = parseOnce(replacement, context, members);
    if (next.status === "query") kept.push({ choice: outcome.choices[k], replacement, members });
    else stop ??= next;
  });
  if (kept.length === outcome.replacements.length) return outcome;
  if (kept.length > 0) return { ...outcome, choices: kept.map((k) => k.choice), replacements: kept.map((k) => k.replacement), ...(kept.some(k => k.members.length) ? {memberSelections:kept.map(k=>k.members)} : {}) };
  return stop?.status === "unsupported" ? stop : unsupported("That could mean several things. Name the store, person and time period you want, and ask again.");
}

export function parseQuestion(question: string, context: ParseContext, selected: AskMemberSelection[] = []): ParseOutcome {
  const outcome = parseOnce(question, context, selected);
  return outcome.status === "clarify" && context.familyMembers !== undefined ? onlyAnswerable(closeChoices(outcome, context, selected), context, selected) : outcome;
}

function parseOnce(question: string, context: ParseContext, selected: AskMemberSelection[] = []): ParseOutcome {
  if (selected.some(member => !Number.isSafeInteger(member.occurrence) || member.occurrence < 0 || !context.familyMembers?.some(known => known.id === member.id && known.name === member.name)) ||
      new Set(selected.map(member => `${nameTokens(member.name).join(" ")}:${member.occurrence}`)).size !== selected.length)
    return unsupported("The family member choices changed. Ask again using the current family member list.");
  if ([...question].length > MAX_QUESTION_CHARS) return unsupported("That question is too long. Keep it under 512 characters.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(context.today)) return unsupported("The app could not read today's date.");

  const tokens = stripBookends(tokenize(question));
  const base = tokens.join(" ");
  const scanned = scan(tokens, context, selected);
  if ("status" in scanned) return scanned;
  const { atoms, corrections } = scanned;
  const of = <K extends Atom["kind"]>(kind: K) => atoms.filter((a): a is Extract<Atom, { kind: K }> => a.kind === kind);
  const has = (kind: Atom["kind"]) => atoms.some((a) => a.kind === kind);

  const wanted = <T extends { excluded?: boolean }>(list: T[]) => list.filter((a) => !a.excluded);
  /** The question with its period phrase swapped for another, dropping a leftover "over", "for" or "in" in front of it. */
  const swapPeriod = (text: string, replacement: string) => {
    const at = base.indexOf(text);
    if (at < 0) return base;
    const before = base.slice(0, at).replace(/\s*\b(?:over|for|in)\s*$/, "");
    return `${before} ${replacement} ${base.slice(at + text.length)}`.replace(/\s+/g, " ").trim();
  };
  const unwanted = <T extends { excluded?: boolean }>(list: T[]) => list.filter((a) => a.excluded);
  const unique = (names: string[]) => [...new Set(names)];
  const categories = unique(wanted(of("category")).map((a) => a.name));
  const excludedCategories = unique(unwanted(of("category")).map((a) => a.name));
  const accounts = [...new Map(wanted(of("account")).map((a) => [a.account.id, a.account])).values()];
  const vendorAtoms = of("vendor");
  const vendors = [...new Map(wanted(vendorAtoms).map((v) => [v.term, v])).values()];
  const excludedVendors = [...new Map(unwanted(vendorAtoms).map((v) => [v.term, v])).values()];

  const scopeWord = atoms.find(
    (a) => a.kind === "unknown" && (NEGATION.has(a.text) || a.text === "before" || a.text === "after" || CHANGES.has(a.text) || FORECAST.has(a.text)),
  );
  if (scopeWord) return unsupported(unknownReason(scopeWord.text));

  const asksWhatIHave = tokenize(question).includes("have") && !has("spend") && !has("total") && !has("rank") && !has("compare");
  if (has("legacy") || has("legacy-entity") || asksWhatIHave) {
    if (has("exclude")) return unsupported("I can't leave things out of questions about balances, income or family members yet.");
    if (has("legacy-entity") && (categories.length || accounts.length || vendors.length || excludedVendors.length)) {
      return unsupported("I can't combine a category, account or store with a person yet. Ask about one at a time.");
    }
    return { status: "legacy" };
  }

  const unknown = atoms.find((a) => a.kind === "unknown");
  if (unknown) return unsupported(unknownReason(unknown.text));

  if (has("exclude")) {
    const left = atoms.filter((a) => a.kind !== "exclude" && "excluded" in a && a.excluded);
    if (left.length === 0) return unsupported('Tell me what to leave out, like a store or a category. For example: "groceries last month without Costco".');
    if (left.some((a) => a.kind === "account")) return unsupported("I can't leave out an account yet. Ask about the account you want instead.");
  }

  const periods = of("period");
  const thresholds = of("threshold");
  const numbers = of("number");
  const version2 = context.familyMembers !== undefined;
  const memberAtoms = of("member");
  const members = [...new Map(memberAtoms.map((a) => [a.id, a])).values()];
  if (unwanted(memberAtoms).length) return unsupported("I can't leave a family member out of a question yet. Name the people you want instead.");
  const unassigned = has("unassigned");
  const byMember = has("by-member");
  const monthly = of("monthly");
  const wantsAverage = has("average");
  const cadences = of("other-cadence");
  const sameDays = of("same-days");

  if (cadences.length) {
    const unit = cadences[0].unit;
    if (wantsAverage && (unit === "day" || unit === "week")) {
      return unsupported(`Averages per ${unit} aren't available yet. I can average per month or per purchase.`);
    }
    return unsupported(`I can only break spending down by month for now, not by ${unit}. Try "by month".`);
  }
  if (wantsAverage && byMember) return unsupported("An average can't be split by family member yet. Ask for the average on its own, or the totals for each family member.");
  if (byMember && monthly.length) return unsupported("I can show one breakdown at a time: by month or by family member, not both together.");

  const groupBy: AskGroupBy = byMember ? "member" : monthly.length && (!wantsAverage || monthly.some((m) => m.group)) ? "month" : "none";
  let average: AskAverageKind = "none";
  if (wantsAverage) {
    const at = tokens.findIndex((t) => t === "average" || t === "avg" || t === "averages");
    const askWhich = (options: Option[]) =>
      ({ status: "clarify", reason: 'The word "average" can mean two different things here. Which one do you want?', ...periodComplete(options, tokens, context) }) as ParseOutcome;
    if (monthly.length && has("purchase")) {
      // "Average monthly purchase": a per-purchase average, or a monthly one? Either way part of the wording would be dropped, so ask.
      const cadence = monthly[0].text.split(" ");
      const gap = tokens.findIndex((_, k) => cadence.every((word, n) => tokens[k + n] === word));
      const without = [...tokens.slice(0, gap), ...tokens.slice(gap + cadence.length)].join(" ");
      const purchaseWord = atoms.find((a) => a.kind === "purchase")!.text;
      const spending = tokens.map((t) => (t === purchaseWord ? "spending" : t)).join(" ");
      return askWhich([
        { label: "Per purchase", question: without },
        { label: "Per month", question: spending },
      ]);
    }
    if (monthly.length) average = "per-month";
    else if (has("purchase")) average = "per-purchase";
    else {
      const reword = (extra: string) => [...tokens.slice(0, at + 1), extra, ...tokens.slice(at + 1)].join(" ");
      return askWhich([
        { label: "Per purchase", question: reword("purchase") },
        { label: "Per month", question: reword("monthly") },
      ]);
    }
  }
  const wantsRankNow = has("rank");
  const wantsCompareNow = has("compare");
  if ((groupBy !== "none" || average !== "none") && (wantsRankNow || wantsCompareNow)) {
    return unsupported(
      wantsCompareNow
        ? "Breakdowns and averages don't combine with comparisons yet. Compare the totals, or ask for the month-by-month lines on their own."
        : "Breakdowns and averages don't combine with rankings yet. Ask for the ranking, or for the breakdown, on its own.",
    );
  }
  if (sameDays.length && !wantsCompareNow) return unsupported('Comparing "the same days" only works in a comparison, like "compare groceries this month to the same days last month".');
  if (sameDays.length > 1) return unsupported("Name the same days once.");
  if (categories.length > 1 && !version2) return unsupported("I can only look at one category at a time for now.");
  if (accounts.length + categories.length + excludedCategories.length + members.length > 20) {
    return unsupported("That names more than 20 accounts, categories and family members at once. Choose 20 or fewer.");
  }
  if (accounts.length > 1) return unsupported("I can only look at one account at a time for now.");
  if (thresholds.length > 1) return unsupported("I can only use one amount filter at a time.");
  if (vendors.length > MAX_STORES || excludedVendors.length > MAX_STORES) return unsupported("That is too many stores for one question. Choose ten or fewer.");
  if (excludedCategories.some((name) => categories.includes(name)) || excludedVendors.some((v) => vendors.some((w) => w.term === v.term))) {
    return unsupported("That question asks for something and also asks to leave it out. Remove one of them.");
  }

  const wantsRank = has("rank");
  const wantsCompare = has("compare");
  const accountIds = accounts.map((a) => a.id);
  const minimumPurchase = thresholds.length ? { amount: thresholds[0].amount, inclusive: thresholds[0].inclusive } : null;
  const category = categories[0] ?? null;
  const anyLeftOut = excludedCategories.length > 0 || excludedVendors.length > 0;

  let kind: AskVaultRequest["kind"];
  let limit: number | null = null;

  if (wantsRank) {
    if (wantsCompare) return unsupported("I can rank things or compare periods, but not both in one question.");
    const plural = has("plural-categories");
    const singularCategory = has("singular-category");
    const purchaseWord = atoms.find((a) => a.kind === "purchase");
    const most = atoms.some((a) => a.kind === "rank" && a.text === "most");
    const mostOn = most && has("spend") && atoms.some((a) => a.kind === "filler" && a.text === "on");
    if (plural || singularCategory || mostOn) kind = "rank-categories";
    else if (purchaseWord) kind = "rank-purchases";
    else {
      // Propose an explicit count rather than expanding 2 kinds × 3 counts × 3 dates beyond the choice limit.
      const proposeFive = context.familyMembers !== undefined && !numbers.length && !most;
      const question = proposeFive ? `${base} 5` : base;
      return clarify("Do you want the biggest categories or the biggest individual purchases?", proposeFive ? ["Top 5 categories", "Top 5 purchases"] : ["Categories", "Purchases"], [`${question} categories`, `${question} purchases`]);
    }
    if (kind === "rank-categories" && categories.length === 1) return unsupported("A ranking of categories can't be limited to one category. Name a category to see its purchases instead.");
    if (numbers.length > 1) return unsupported("Use one number for how many results to show.");
    if (numbers.length === 1) limit = numbers[0].value;
    else if (most || singularCategory || (purchaseWord && !purchaseWord.text.endsWith("s"))) limit = 1;
    else return clarify("How many results should I show?", ["3", "5", "10"], [`${base} 3`, `${base} 5`, `${base} 10`]);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return unsupported("Choose between 1 and 50 results.");
  } else if (wantsCompare) {
    kind = "compare";
    if (numbers.length) return unsupported("A comparison can't use a result count. Name two time periods to compare.");
    if (!version2 && thresholds.length) return unsupported("A comparison can't use an amount filter yet.");
    if (has("plural-categories")) return unsupported("A comparison can't rank categories yet.");
  } else {
    kind = "total";
    const understood =
      has("spend") || has("total") || category !== null || accounts.length > 0 || thresholds.length > 0 || vendors.length > 0 || anyLeftOut ||
      members.length > 0 || unassigned || groupBy !== "none" || average !== "none";
    if (!understood && has("purchase")) {
      return unsupported('To see your transactions, open the Transactions tab. Or ask for a total, like "how much did I spend last month", or the biggest ones, like "top 5 purchases last month".');
    }
    if (!understood) return unsupported("Tell me what to add up, like spending on a category, and a time period.");
    if (numbers.length || has("plural-categories")) return unsupported("I wasn't sure what that number or the word \"categories\" is for. Try rephrasing.");
  }

  if (context.historyStart) {
    const start = context.historyStart;
    if (periods.some((p) => p.period.to < start)) {
      return unsupported(`I don’t have records that go back that far. Your first recorded transaction is on ${dayLabel(start)}.`);
    }
  }

  const wantedPeriods = kind === "compare" && !sameDays.length ? 2 : 1;
  const resolved = periods.map((p) => p.period);
  let alignment: AskAlignment = "as-requested";
  if (resolved.length === 0 && vendors.length > 0 && kind !== "compare" && context.historyStart) {
    resolved.push({ from: context.historyStart, to: context.today, label: "all your records", soFar: false, allRecords: true });
  }
  if (resolved.length === 0) {
    const options = kind === "compare" ? undefined : [`${base} last month`, `${base} this month`, `${base} this year`];
    return clarify("Which time period should I use?", options ? ["Last month", "This month so far", "This year so far"] : [], options);
  }
  if (resolved.length !== wantedPeriods) {
    if (sameDays.length) return unsupported('Name one time period and say "the same days last month" (or last year) for the other, like "compare groceries this month to the same days last month".');
    return unsupported(wantedPeriods === 2 ? "Name two time periods to compare." : "Ask about one time period, or use \"compare\" to look at two.");
  }
  if (sameDays.length) {
    alignment = sameDays[0].alignment;
    const first = resolved[0];
    const earlier = alignedPrior({ from: first.from, to: first.to }, alignment);
    if (earlier === null) {
      return unsupported(
        alignment === "same-days-previous-month"
          ? 'To compare the same days of the month before, start with one calendar month, like "this month so far" or "February".'
          : "I couldn't work out the same days a year earlier for that period.",
      );
    }
    if (sameDays[0].month !== undefined && Number(earlier.range.from.slice(5, 7)) !== sameDays[0].month) {
      return unsupported("The same days have to be in the month right before the first one. Name that month, or say \"last month\".");
    }
    resolved.push({ from: earlier.range.from, to: earlier.range.to, label: alignment === "same-days-previous-month" ? "the same days in the month before" : "the same days a year earlier", soFar: false });
  }

  // A month-by-month answer is at most 50 lines; a longer range is a question, because the lines must add back to the total.
  const monthLines = groupBy === "month" || average === "per-month";
  if (monthLines && periods.length === 1 && monthsTouching(resolved[0]).length > 50) {
    const text = periods[0].text;
    const shorter = (replacement: string) => swapPeriod(text, replacement);
    return clarify(
      "That would be more than 50 months, which is too many lines to show without leaving some out. Which range should I use?",
      ["The last 12 months", "The last 4 years"],
      [shorter("the past 12 months"), shorter("the past 4 years")],
    );
  }
  // "The past 3 months" starts part-way through a month, and only whole months can be averaged.
  const rolling = /^the past (\d+) (month|year)s?$/.exec(periods[0]?.period.label ?? "");
  if (average === "per-month" && rolling && periods.length === 1) {
    const count = Number(rolling[1]) * (rolling[2] === "year" ? 12 : 1);
    const today = context.today;
    const thisMonth = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
    const startIndex = thisMonth.y * 12 + (thisMonth.m - 1) - count;
    const start = isoDate(Math.floor(startIndex / 12), (startIndex % 12) + 1, 1);
    const endIndex = thisMonth.y * 12 + (thisMonth.m - 1) - 1;
    const end = isoDate(Math.floor(endIndex / 12), (endIndex % 12) + 1, daysInMonth(Math.floor(endIndex / 12), (endIndex % 12) + 1));
    const text = periods[0].text;
    const using = (from: string, to: string) => swapPeriod(text, `from ${from} to ${to}`);
    return clarify(
      "Only whole months can be averaged, and that range starts part-way through a month. Which one do you want?",
      [`The ${count} whole months before this one`, `Exactly ${periods[0].period.label}, as asked`],
      [using(start, end), using(periods[0].period.from, periods[0].period.to)],
    );
  }

  const needsVersion2 =
    version2 && (categories.length > 1 || members.length > 0 || unassigned || groupBy !== "none" || average !== "none" || alignment !== "as-requested");
  const plain: AskVaultRequest = {
    kind,
    periods: resolved.map(({ from, to }) => ({ from, to })),
    accountIds,
    categories: needsVersion2 ? categories : category ? [category] : [],
    minimumPurchase,
    vendors: vendors.map((v) => v.term),
    excludeVendors: excludedVendors.map((v) => v.term),
    excludeCategories: excludedCategories,
    limit: limit ?? 1,
    expectedRevision: null,
  };
  const request: AskVaultRequest | AskVaultRequestV2 = needsVersion2
    ? { ...plain, contractVersion: 2, members: { ids: members.map((m) => m.id), unassigned }, groupBy, average, alignment }
    : plain;
  const interpretation: Interpretation = {
    kind,
    category,
    accountName: accounts[0]?.name ?? null,
    vendors: vendors.map((v) => v.label),
    excludedVendors: excludedVendors.map((v) => v.label),
    excludedCategories,
    periods: resolved,
    minimumPurchase,
    limit,
    earliestRecord: context.historyStart ?? null,
    ...(needsVersion2
      ? { categories, members: [...members.map((m) => m.name), ...(unassigned ? ["purchases not assigned to anyone"] : [])], groupBy, average, alignment }
      : {}),
  };
  void listNames;
  return { status: "query", request, interpretation, corrections };
}

/**
 * "Kroger and Home dept": in a list of stores the first word ("home") starts a recorded store and the next ("dept") is a slip in that store's second word. The same
 * words directly after "at" are one typed name and already ask; here they would have been read as a store and an unknown second store, and refused. When the whole run of
 * words is not a recorded name's start, the typed first word has close recorded names (the store rule's own suggestions), a shorter run is a recorded store, and the
 * remaining words are not a store, a close store, a category or account (or a slip in one), a family member, a number, a grammar word or slip, or quoted, and the whole typed run is within one slip of a recorded name that starts with the words already matched, the run is one typed name: ask with the close names.
 * Nothing is chosen for the person (mandatory choice, typoRules.json store decision). Returns null whenever any condition fails, leaving the old reading untouched.
 */
function laterWordSlip(tokens: string[], i: number, n: number, context: ParseContext): { atom: Atom; count: number } | ParseOutcome | null {
  const merchants = context.merchants ?? [];
  const whole = resolveVendor(tokens.slice(i, i + n).join(" "), merchants, false);
  if (whole.status !== "none" || whole.suggestions.length === 0) return null;
  let k = n - 1;
  while (k >= 1 && resolveVendor(tokens.slice(i, i + k).join(" "), merchants, false).status === "none") k--;
  if (k < 1) return null;
  const rest = tokens.slice(i + k, i + n);
  const entities = buildEntities(context);
  const unrelated = rest.every((w, m) => !w.startsWith('"') && w !== "," && !LEGACY_WORDS.has(w) && NUMBER_WORDS[w] === undefined && WORD_TYPOS[w] === undefined && !/\d/.test(w)
    && !entities.some((e) => e.parts.includes(w)) && !(context.members ?? []).some((m2) => nameTokens(m2).includes(w)) && fuzzyMatches(tokens, i + k + m, entities).length === 0);
  if (!unrelated) return null;
  const alone = resolveVendor(rest.join(" "), merchants, false);
  if (alone.status !== "none" || alone.suggestions.length > 0) return null;
  // The slip must be in the store's own name: the whole typed run is within one slip of a recorded name that starts with the words already matched.
  const hit = resolveVendor(tokens.slice(i, i + k).join(" "), merchants, false);
  const brands = hit.status === "matched" ? hit.names.map((name) => recordedName(name).join(" ")) : hit.status === "ambiguous" ? hit.choices.map((c) => c.term) : [];
  const typed = vendorWords(tokens.slice(i, i + n).join(" ")).join(" ");
  if (!brands.some((brand) => distance(typed, brand, 1) <= 1)) return null;
  const found = vendorAtom(tokens, i, n, false, context, false);
  return "status" in found ? found : null;
}
