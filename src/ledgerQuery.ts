import Fuse from "fuse.js";
import { isTransferTransaction } from "./transfers";
import type { Account, Bucket, Recurring, Transaction } from "./types";
import { isIncomeTransaction } from "./accountGroups";
import { toLocalIsoDate } from "./format";

/** Everything a question might need — all of it already sitting in App.tsx
 * state, so answering a question is a pure client-side computation, never
 * a network or even a fresh Tauri call. Answers are only ever as current
 * as this data already is (whatever the Dashboard last fetched). */
export type QaContext = {
  transactions: Transaction[];
  categories: string[];
  accounts: Account[];
  buckets: Bucket[];
  recurring: Recurring[];
  avgMonthlySpend: string;
  today: Date;
};

export type DateRange = { from: Date; to: Date };

export function inRange(dateStr: string, range: DateRange): boolean {
  return dateStr >= toLocalIsoDate(range.from) && dateStr <= toLocalIsoDate(range.to);
}

// ---------------------------------------------------------------------------
// Fuzzy matching — typo-tolerant lookups against the app's own real,
// user-curated names (categories, accounts, bucket names, merchants, family
// members), replacing a hand-rolled exact-then-substring check. Fuse does
// lexical fuzzy matching (edit-distance-ish), not synonyms — "dinning" finds
// "Dining Out", but "restaurant" won't, since that's a meaning match, not a
// typo. A single shared low threshold keeps every lookup's tolerance
// consistent.
const FUSE_OPTIONS = { includeScore: true, threshold: 0.4 };

export function fuzzyFind<T>(phrase: string, items: T[], key: (item: T) => string): T | null {
  const trimmed = phrase.trim();
  if (!trimmed || items.length === 0) return null;
  const exact = items.find((item) => key(item).toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const fuse = new Fuse(items.map(key), FUSE_OPTIONS);
  const hit = fuse.search(trimmed)[0];
  return hit ? items[hit.refIndex] : null;
}

export function findCategory(phrase: string, categories: string[]): string | null {
  return fuzzyFind(phrase, categories, (c) => c);
}

export function findAccount(phrase: string, accounts: Account[]): Account | null {
  return fuzzyFind(phrase, accounts, (a) => a.name);
}

export function findMerchant(phrase: string, transactions: Transaction[]): string | null {
  const descriptions = Array.from(new Set(transactions.map((t) => t.description)));
  return fuzzyFind(phrase, descriptions, (d) => d);
}

/** Family members aren't a separate list on `QaContext` — every transaction
 * already carries its own `member_name`, so the distinct set of those (same
 * pattern as `findMerchant` pulling distinct descriptions straight off
 * transactions) is all a member lookup needs. */
export function findMember(phrase: string, transactions: Transaction[]): string | null {
  const names = Array.from(new Set(transactions.map((t) => t.member_name).filter((n): n is string => n !== null)));
  return fuzzyFind(phrase, names, (n) => n);
}

// ---------------------------------------------------------------------------
// The query engine — a small set of composable primitives (filter by
// subject/period/sign, aggregate by sum/avg/count/max/min, optionally
// grouped) that every transaction-aggregate question reduces to, instead of
// each question re-implementing its own filter+reduce. Deliberately plain
// data (no closures, no regex match arrays) so `Query` stays a clean,
// serializable shape — the same contract a future natural-language front
// end would target, even though none exists yet.
//
// Scoped to *transaction*-aggregate questions specifically (spend, income,
// averages, counts, comparisons). Net worth/debt/balance (accounts),
// subscriptions/next-bill (recurring), and bucket progress (buckets) are
// each a single fixed report, not a combinatorial filter+aggregate
// question, so they stay their own special-cased handlers in ledgerQa.ts
// rather than being forced through this engine.

export type Metric = "sum" | "avg" | "count" | "max" | "min";

/** "income" means whatever `isIncomeTransaction` (accountGroups.ts) counts
 * as income — a positive amount that isn't a Transfer or a credit/loan
 * account's own balance-side entry, the same rule Cash Flow's backend uses,
 * regardless of what the transaction is actually categorized as. "expense"
 * is any negative amount, regardless of category. */
export type Sign = "expense" | "income" | "both";

export type Subject = { type: "category" | "merchant" | "account" | "member"; value: string };

export type Query = {
  metric: Metric;
  sign: Sign;
  subject?: Subject;
  period?: DateRange;
  groupBy?: "category" | "month" | "member";
};

export type QueryResult = {
  value: number;
  count: number;
  matches: Transaction[];
  groups?: { label: string; value: number; count: number }[];
};

/** Resolves free text into a `Subject` of the given type via the matching
 * fuzzy lookup above. Returns `null` on no match — callers craft their own
 * "I couldn't find X" message, since that phrasing is intent-specific. */
export function resolveSubject(type: Subject["type"], phrase: string, ctx: QaContext): Subject | null {
  switch (type) {
    case "category": {
      const c = findCategory(phrase, ctx.categories);
      return c ? { type, value: c } : null;
    }
    case "merchant": {
      const m = findMerchant(phrase, ctx.transactions);
      return m ? { type, value: m } : null;
    }
    case "account": {
      const a = findAccount(phrase, ctx.accounts);
      return a ? { type, value: a.name } : null;
    }
    case "member": {
      const m = findMember(phrase, ctx.transactions);
      return m ? { type, value: m } : null;
    }
  }
}

function matchesSubject(t: Transaction, subject: Subject): boolean {
  switch (subject.type) {
    case "category":
      return t.category === subject.value;
    case "merchant":
      return t.description === subject.value;
    case "account":
      return t.account_name === subject.value;
    case "member":
      return (t.member_name ?? "Unassigned") === subject.value;
  }
}

/** A transaction's contribution toward a metric, sign-aware: expense
 * amounts are already negative, so their magnitude is what a person means
 * by "how much" — but income is reported as its real (positive) amount
 * rather than an absolute value, matching the sum this replaces
 * (`incomeAndExpense`, previously in ledgerQa.ts) exactly. */
function magnitude(t: Transaction, sign: Sign): number {
  const amount = parseFloat(t.amount);
  return sign === "income" ? amount : Math.abs(amount);
}

function aggregate(matches: Transaction[], metric: Metric, sign: Sign): number {
  if (metric === "count") return matches.length;
  const magnitudes = matches.map((t) => magnitude(t, sign));
  if (magnitudes.length === 0) return 0;
  switch (metric) {
    case "sum":
      return magnitudes.reduce((s, n) => s + n, 0);
    case "avg":
      return magnitudes.reduce((s, n) => s + n, 0) / magnitudes.length;
    case "max":
      return Math.max(...magnitudes);
    case "min":
      return Math.min(...magnitudes);
  }
}

export function runQuery(query: Query, ctx: QaContext): QueryResult {
  const askedAboutTransferDirectly = query.subject?.type === "category" && query.subject.value === "Transfer";
  const matches = ctx.transactions.filter((t) => {
    if (query.sign === "expense") {
      if (parseFloat(t.amount) >= 0) return false;
      // Money moving between the household's own accounts isn't spending —
      // excluded here the same way `Store::monthly_totals` excludes it on
      // the backend, unless the question is specifically about the
      // Transfer category itself.
      if (isTransferTransaction(t) && !askedAboutTransferDirectly) return false;
    }
    if (query.sign === "income" && !isIncomeTransaction(t, ctx.accounts)) return false;
    if (query.subject && !matchesSubject(t, query.subject)) return false;
    if (query.period && !inRange(t.date, query.period)) return false;
    return true;
  });

  const value = aggregate(matches, query.metric, query.sign);

  if (!query.groupBy) {
    return { value, count: matches.length, matches };
  }

  const buckets = new Map<string, Transaction[]>();
  for (const t of matches) {
    const key =
      query.groupBy === "category"
        ? (t.category ?? "Uncategorized")
        : query.groupBy === "member"
          ? (t.member_name ?? "Unassigned")
          : t.date.slice(0, 7); // "month" — a raw "YYYY-MM" key; callers format the label
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }
  const groups = Array.from(buckets.entries())
    .map(([label, txns]) => ({ label, value: aggregate(txns, query.metric, query.sign), count: txns.length }))
    .sort((a, b) => b.value - a.value);

  return { value, count: matches.length, matches, groups };
}

/** The same query run over two different periods — generalizes what used
 * to be a single hardcoded "compare total spend" helper into any
 * metric/subject, so "compare my Dining Out in July to June" is answerable,
 * not just "compare July to June" (total spend only). */
export function compareQuery(
  query: Omit<Query, "period">,
  periodA: DateRange,
  periodB: DateRange,
  ctx: QaContext,
): { a: QueryResult; b: QueryResult } {
  return {
    a: runQuery({ ...query, period: periodA }, ctx),
    b: runQuery({ ...query, period: periodB }, ctx),
  };
}
