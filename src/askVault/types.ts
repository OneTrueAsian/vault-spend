/** Shared shapes for the deterministic Ask the Vault question handling. */

/** An inclusive calendar range, "YYYY-MM-DD" on both ends. This is exactly what the native read accepts. */
export type PeriodRange = { from: string; to: string };

/** A range plus how to describe it to the person asking. */
export type ResolvedPeriod = PeriodRange & {
  /** Short plain-language name, e.g. "August 2026", "the past 3 months". */
  label: string;
  /** True for a calendar month, quarter, week or year that is still under way (it ends today). */
  soFar: boolean;
  /** True when no period was named and every recorded day is covered. */
  allRecords?: boolean;
};

export type AskAccount = { id: number; name: string };

/** Everything the parser may know. All of it is already on the Dashboard; no extra read is needed. */
export type ParseContext = {
  /** The app-owned local date, "YYYY-MM-DD". Never the clock inside the parser. */
  today: string;
  categories: string[];
  accounts: AskAccount[];
  /** Earliest recorded transaction date, when known. Used only to ask which year a bare month means. */
  historyStart?: string;
  /** Names the older matcher still owns (merchants, family members); used to hand those questions over. */
  merchants?: string[];
  members?: string[];
};

export type AskKind = "total" | "rank-categories" | "rank-purchases" | "compare";

export type AskDataRevision = { local: number; external: number };

/** The typed request the native `get_ask_vault_snapshot` command accepts. Never contains question text. */
export type AskVaultRequest = {
  kind: AskKind;
  periods: PeriodRange[];
  accountIds: number[];
  categories: string[];
  minimumPurchase: { amount: string; inclusive: boolean } | null;
  /** Stores or payees as lowercase words (at most ten). A purchase counts when any of them matches its description. */
  vendors: string[];
  /** Stores and categories to leave out; the reply reports what they removed. */
  excludeVendors: string[];
  excludeCategories: string[];
  limit: number;
  expectedRevision: AskDataRevision | null;
};

/** What the parser understood, in words the person can check before trusting the number. */
export type Interpretation = {
  kind: AskKind;
  category: string | null;
  accountName: string | null;
  /** The stores or payees as the person wrote them, e.g. "Sam's Club". */
  vendors: string[];
  excludedVendors: string[];
  excludedCategories: string[];
  periods: ResolvedPeriod[];
  /** Plain text such as "$100.01", with the comparison word kept separate. */
  minimumPurchase: { amount: string; inclusive: boolean } | null;
  limit: number | null;
  /** Date of the first recorded transaction, when known; earlier days have no data. */
  earliestRecord?: string | null;
};

export type Correction = { from: string; to: string };

export type ParseOutcome =
  | { status: "query"; request: AskVaultRequest; interpretation: Interpretation; corrections: Correction[] }
  /** `replacements`, when present, holds a ready question for each choice (same order), so the screen can re-ask. */
  | { status: "clarify"; reason: string; choices: string[]; replacements?: string[] }
  | { status: "unsupported"; reason: string }
  /** The older matcher owns this question (balances, net worth, income, member and merchant questions...). */
  | { status: "legacy" };
