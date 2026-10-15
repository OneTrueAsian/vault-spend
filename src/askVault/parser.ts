import { dayLabel, matchPeriod, MONTHS, tokenize } from "./dates";
import { distance } from "./distance";
import { anyVendorMatches, resolveVendor, vendorTerm } from "./vendor";
import type { AskAccount, AskVaultRequest, Correction, Interpretation, ParseContext, ParseOutcome, ResolvedPeriod } from "./types";

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

type Entity = { name: string; parts: string[]; kind: "category" | "account" | "legacy"; account?: AskAccount };

function buildEntities(context: ParseContext): Entity[] {
  const entities: Entity[] = [
    ...context.categories.map<Entity>((name) => ({ name, parts: name.toLowerCase().split(/\s+/), kind: "category" })),
    ...context.accounts.map<Entity>((account) => ({ name: account.name, parts: account.name.toLowerCase().split(/\s+/), kind: "account", account })),
    ...(context.members ?? []).map<Entity>((name) => ({ name, parts: name.toLowerCase().split(/\s+/), kind: "legacy" })),
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
  for (const entity of entities) {
    if (RESERVED_START.has(entity.parts[0])) continue;
    const phrase = tokens.slice(i, i + entity.parts.length).join(" ");
    if (phrase.length >= 3 && distance(phrase, entity.name.toLowerCase()) <= 1) {
      found.push({ entity, consume: entity.parts.length });
      continue;
    }
    const first = entity.parts[0];
    const minimum = entity.kind === "legacy" ? 4 : 3;
    const singleWord = w.length >= minimum && /^\p{L}+$/u.test(w) && (first.startsWith(w) || distance(w, first) <= 1);
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

/** A word the grammar does not know may still be a store: try it (and up to three words after it) against the names on record. */
function implicitVendor(tokens: string[], i: number, context: ParseContext, strict = true): { atom: Atom; count: number } | ParseOutcome | null {
  if (isStructural(tokens, i, context) || (context.merchants ?? []).length === 0) return null;
  for (let n = Math.min(4, tokens.length - i); n >= 1; n--) {
    if (Array.from({ length: n }, (_, k) => i + k).some((k) => isStructural(tokens, k, context))) continue;
    const raw = tokens.slice(i, i + n).join(" ");
    const resolution = resolveVendor(raw, context.merchants ?? [], strict);
    if (resolution.status === "none") continue;
    const found = vendorAtom(tokens, i, n, false, context, strict);
    return "status" in found ? found : { atom: found, count: n };
  }
  return null;
}

function scan(tokens: string[], context: ParseContext): { atoms: Atom[]; corrections: Correction[] } | ParseOutcome {
  const entities = buildEntities(context);
  const atoms: Atom[] = [];
  const corrections: Correction[] = [];
  const display = (from: number, count: number) => tokens.slice(from, from + count).join(" ");
  // "Without ..." marks the names that follow as things to leave out, until a period, amount or verb ends the list.
  let excluding = false;
  // After a store, further names in a list (", sams club and target") may be written without "at".
  let vendorList = false;
  const add = (atom: Atom) => {
    const named = atom.kind === "category" || atom.kind === "account" || atom.kind === "vendor" || atom.kind === "legacy-entity";
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
      const name = w.slice(1, -1);
      const hit = entities.find((e) => e.name.toLowerCase() === name);
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

    // A misspelled name of two or more words ("cash wallt") is that name, not its first word taken as something older.
    const spelled = fuzzyMatches(tokens, i, entities).filter((m) => m.consume > 1 && m.entity.kind !== "legacy");
    if (spelled.length) {
      const longest = Math.max(...spelled.map((m) => m.consume));
      const best = spelled.filter((m) => m.consume === longest);
      if (new Set(best.map((m) => m.entity.name)).size === 1) {
        const { entity, consume } = best[0];
        const text = display(i, consume);
        add(entityAtom(entity, text));
        if (text !== entity.name.toLowerCase()) corrections.push({ from: text, to: entity.name });
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

    if (LEGACY_WORDS.has(w)) {
      add({ kind: "legacy", text: w });
      i++;
      continue;
    }

    if (vendorList || excluding) {
      const listed = implicitVendor(tokens, i, context, !vendorList);
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
    if ((vendorList || excluding) && candidates.length > 0 && candidates.every((m) => display(i, m.consume) !== m.entity.name.toLowerCase() && !m.entity.parts[0].startsWith(w))) {
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
      if (entity.kind !== "legacy" && text !== entity.name.toLowerCase()) corrections.push({ from: text, to: entity.name });
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
  if (word === "%" || word === "percentage" || word === "percent" || word === "discount") return "I can't work with percentages or discounts in a question yet.";
  if (CHANGES.has(word)) return "Asking a question can't change your data. Use the buttons in the app to make changes.";
  return `I don't understand "${word}" yet. Try a category name, a time period like "last month", or something like "top 3".`;
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function parseQuestion(question: string, context: ParseContext): ParseOutcome {
  if ([...question].length > MAX_QUESTION_CHARS) return unsupported("That question is too long. Keep it under 512 characters.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(context.today)) return unsupported("The app could not read today's date.");

  const tokens = stripBookends(tokenize(question));
  const base = tokens.join(" ");
  const scanned = scan(tokens, context);
  if ("status" in scanned) return scanned;
  const { atoms, corrections } = scanned;
  const of = <K extends Atom["kind"]>(kind: K) => atoms.filter((a): a is Extract<Atom, { kind: K }> => a.kind === kind);
  const has = (kind: Atom["kind"]) => atoms.some((a) => a.kind === kind);

  const wanted = <T extends { excluded?: boolean }>(list: T[]) => list.filter((a) => !a.excluded);
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
  if (categories.length > 1) return unsupported("I can only look at one category at a time for now.");
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
    else return clarify("Do you want the biggest categories or the biggest individual purchases?", ["Categories", "Purchases"], [`${base} categories`, `${base} purchases`]);
    if (kind === "rank-categories" && category) return unsupported("A ranking of categories can't be limited to one category. Name a category to see its purchases instead.");
    if (numbers.length > 1) return unsupported("Use one number for how many results to show.");
    if (numbers.length === 1) limit = numbers[0].value;
    else if (most || singularCategory || (purchaseWord && !purchaseWord.text.endsWith("s"))) limit = 1;
    else return clarify("How many results should I show?", ["3", "5", "10"], [`${base} 3`, `${base} 5`, `${base} 10`]);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return unsupported("Choose between 1 and 50 results.");
  } else if (wantsCompare) {
    kind = "compare";
    if (numbers.length || thresholds.length) return unsupported("A comparison can't use an amount filter or a count yet.");
    if (has("plural-categories")) return unsupported("A comparison can't rank categories yet.");
  } else {
    kind = "total";
    const understood =
      has("spend") || has("total") || category !== null || accounts.length > 0 || thresholds.length > 0 || vendors.length > 0 || anyLeftOut;
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

  const wantedPeriods = kind === "compare" ? 2 : 1;
  const resolved = periods.map((p) => p.period);
  if (resolved.length === 0 && vendors.length > 0 && kind !== "compare" && context.historyStart) {
    resolved.push({ from: context.historyStart, to: context.today, label: "all your records", soFar: false, allRecords: true });
  }
  if (resolved.length === 0) {
    const options = kind === "compare" ? undefined : [`${base} last month`, `${base} this month`, `${base} this year`];
    return clarify("Which time period should I use?", options ? ["Last month", "This month so far", "This year so far"] : [], options);
  }
  if (resolved.length !== wantedPeriods) {
    return unsupported(wantedPeriods === 2 ? "Name two time periods to compare." : "Ask about one time period, or use \"compare\" to look at two.");
  }

  const request: AskVaultRequest = {
    kind,
    periods: resolved.map(({ from, to }) => ({ from, to })),
    accountIds,
    categories: category ? [category] : [],
    minimumPurchase,
    vendors: vendors.map((v) => v.term),
    excludeVendors: excludedVendors.map((v) => v.term),
    excludeCategories: excludedCategories,
    limit: limit ?? 1,
    expectedRevision: null,
  };
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
  };
  void listNames;
  return { status: "query", request, interpretation, corrections };
}
