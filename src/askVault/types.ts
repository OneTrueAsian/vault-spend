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
  /**
   * Version 2: the family members with their ids. Without it every member question is handed to the older matcher exactly as before;
   * with it, member questions are understood here.
   */
  familyMembers?: AskFamilyMember[];
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
  /** Version 2: the family members chosen (names as the person has them), "not assigned to anyone" included when asked. */
  members?: string[];
  /** Version 2: every category chosen, in the order asked (an OR); `category` stays the first one. */
  categories?: string[];
  groupBy?: AskGroupBy;
  average?: AskAverageKind;
  alignment?: AskAlignment;
  /** Date of the first recorded transaction, when known; earlier days have no data. */
  earliestRecord?: string | null;
};

export type Correction = { from: string; to: string };

export type AskClarification = {
  status: "clarify";
  reason: string;
  choices: string[];
  /** Ready questions in the same order as the visible choices. */
  replacements?: string[];
  /** Explicit member bindings for each choice. Names are display text; ids distinguish lookalikes. */
  memberSelections?: AskMemberSelection[][];
};

export type ParseOutcome =
  | { status: "query"; request: AskVaultRequest | AskVaultRequestV2; interpretation: Interpretation; corrections: Correction[] }
  | AskClarification
  | { status: "unsupported"; reason: string }
  /** The older matcher owns this question (balances, net worth, income, member and merchant questions...). */
  | { status: "legacy" };

// ---- Version 2 (M2): several categories, family members, month grouping, averages and aligned comparisons ----

/** Members are chosen by exact id, like accounts. `unassigned` adds purchases that carry no family member. */
export type MemberSelector = { ids: number[]; unassigned: boolean };
/** One row per calendar month ("month") or per family member ("member"). Only with kind total and one period. */
export type AskGroupBy = "none" | "month" | "member";
/** Only with kind total and one period; not together with groupBy "member". */
export type AskAverageKind = "none" | "per-purchase" | "per-month";
/** How a compare's second range relates to its first. The aligned modes require exactly the aligned range (see calendar.ts). */
export type AskAlignment = "as-requested" | "same-days-previous-month" | "same-days-previous-year";

/**
 * The version 2 request. Every version 1 field keeps its meaning; several `categories` are an OR, different dimensions an AND,
 * and `members: { ids: [], unassigned: false }` means everyone including unassigned purchases.
 */
export type AskVaultRequestV2 = AskVaultRequest & {
  contractVersion: 2;
  members: MemberSelector;
  groupBy: AskGroupBy;
  average: AskAverageKind;
  alignment: AskAlignment;
};

/** A family member the Dashboard knows, so a question can be turned into an exact member selection. */
export type AskFamilyMember = { id: number; name: string };

/** A chosen person for one occurrence of a normalized name, so two lookalikes can both be selected. */
export type AskMemberSelection = AskFamilyMember & { occurrence: number };
