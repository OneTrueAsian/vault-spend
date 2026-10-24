// Source-attributed test-only copy: M2/oracle/contract-v2.ts
// Original SHA256: 02e6ad9945879a00a385effad50573ae4fd185a7a5e07bb358573f61be3ad8bb
// M6 extension: M1 leave-out rules; no production imports or financial formula changes.
// M2 request/response contract, version 2. Types only: this file is the written specification the tests, oracle and
// (later) the app implement. It imports nothing from the app. Narrative rules live in ../Contract.md and ../Financial-Rules.md.
//
// Compatibility: a request without `contractVersion` (or with 1) is an M1 request and gets an M1 (version 1) reply, field for
// field. Version 2 only adds fields; no M1 field changes meaning.

export type PeriodRange = { from: string; to: string };
export type AskKind = "total" | "rank-categories" | "rank-purchases" | "compare";
export type AskDataRevision = { local: number; external: number };

/** Members are chosen by exact id, like accounts. `unassigned` adds purchases that carry no family member. */
export type MemberSelector = { ids: number[]; unassigned: boolean };

/** All four extension fields are required, including neutral values; v2 has no inferred extension defaults. */
export type AskVaultRequestV2 = {
  contractVersion: 2;
  kind: AskKind;
  periods: PeriodRange[];
  accountIds: number[];
  /** Several names are an OR; an allocation belongs to exactly one category. Exact names, never fuzzy. */
  categories: string[];
  /** { ids: [], unassigned: false } means everyone, including unassigned purchases. */
  members: MemberSelector;
  minimumPurchase: { amount: string; inclusive: boolean } | null;
  vendors: string[];
  excludeVendors: string[];
  excludeCategories: string[];
  limit: number;
  /** One row per calendar month ("month") or per family member ("member"). Non-neutral values need kind total and one period. */
  groupBy: "none" | "month" | "member";
  /** "none" is neutral; averages need kind total and one period, not together with groupBy "member". */
  average: "none" | "per-purchase" | "per-month";
  /**
   * "as-requested" is neutral for any kind; for compare it compares the two ranges as given. Other values need kind compare. The other two require periods[1] to be exactly the
   * alignment of periods[0]: "same-days-previous-month" needs periods[0] to start on the 1st of a month and stay inside it, and
   * compares it with the same day numbers of the month before (stopping at that month's last day if it is shorter);
   * "same-days-previous-year" moves both ends back one calendar year (29 February becomes 28 February).
   */
  alignment: "as-requested" | "same-days-previous-month" | "same-days-previous-year";
  expectedRevision: AskDataRevision | null;
};

export type CategoryRow = { category: string | null; amount: string; purchaseCount: number };
export type PurchaseRow = { transactionId: number; accountId: number; date: string; description: string; amount: string; parentAmount: string };
/** One line per selected category, in request order. Totals add up to the period total; counts may overlap (a split purchase). */
export type CategoryTotal = { category: string; total: string; purchaseCount: number };
/** memberId null is the unassigned line. Totals and counts both add up to the period's. */
export type MemberTotal = { memberId: number | null; name: string | null; total: string; purchaseCount: number };
/**
 * Whether a calendar month can be trusted as a whole month of the person's spending. Only "complete" months enter an average.
 * The evidence is the records of the accounts that hold matching purchases (see `PeriodResultV2.recordedFrom`), never the first
 * transaction date of the whole ledger.
 */
export type MonthCoverage = "complete" | "in-progress" | "partial-period" | "partly-recorded" | "before-records" | "no-records" | "records-end";
/** Totals and counts add up to the period's. Empty months are present, with zero and count 0. */
export type MonthRow = {
  month: string; // "YYYY-MM"
  from: string; // first day of the month that lies inside the period
  to: string;
  dayCount: number;
  coverage: MonthCoverage;
  /** Records of any kind (any amount, category or member) in the accounts the question covers (the chosen accounts, else all) dated inside from..to, today at most; 0 means no records are present in this scope and month; import history is unavailable. */
  recordCount: number;
  total: string;
  purchaseCount: number;
};
export type AverageLeftOut = { month: string; why: Exclude<MonthCoverage, "complete"> };
export type AskAverage = {
  basis: "per-purchase" | "per-month";
  /** What was divided: the period total (per-purchase) or the sum of the months used (per-month). */
  numerator: string;
  /** Distinct purchases, or number of months used. */
  denominator: number;
  /** Rounded half away from zero to cents; null when `unavailable` is set. Never a made-up zero. */
  value: string | null;
  unavailable: null | "no-purchases" | "no-complete-months";
  monthsUsed: string[];
  monthsLeftOut: AverageLeftOut[];
};

export type PeriodResultV2 = {
  from: string;
  to: string;
  dayCount: number;
  endsToday: boolean;
  historyCoverage: "unknown";
  /**
   * Only when `months` are present, which is when the question groups by month or asks for a per-month average (else null). The evidence accounts are those with at least one purchase, on or before today,
   * that matches every filter of the question (any date). `recordedFrom` is the latest, over those accounts, of the date of the
   * account's first record: before it, some account was not being recorded yet. `recordedThrough` is the earliest of the last record dates of
   * those accounts, today at most: one account cannot mask another account that stopped. The boundaries can be reversed when
   * the recording spans do not overlap; no month then qualifies for an average. Both null when no account holds a match.
   */
  recordedFrom: string | null;
  recordedThrough: string | null;
  total: string;
  purchaseCount: number;
  categoryCount: number;
  categories: CategoryRow[];
  purchases: PurchaseRow[];
  vendors: { description: string; purchaseCount: number }[];
  vendorNameCount: number;
  vendorTotals: { term: string; total: string; purchaseCount: number }[];
  leftOut: { total: string; purchaseCount: number; vendors: { description: string; purchaseCount: number }[]; categories: CategoryRow[] };
  // Added in version 2 (empty arrays / null when not asked for):
  categoryTotals: CategoryTotal[];
  /** Sum of the category lines' counts minus the period's distinct purchases: how many extra times a split purchase sits in a second chosen category. 0 without category lines. */
  sharedPurchaseCount: number;
  memberTotals: MemberTotal[];
  months: MonthRow[];
  average: AskAverage | null;
};

export type PercentOutcome = "changed" | "no-change" | "from-zero" | "not-comparable";
export type AskComparison = {
  alignment: "as-requested" | "same-days-previous-month" | "same-days-previous-year";
  /** True only when both periods have the same number of days. */
  comparable: boolean;
  notComparableReason: null | "unequal-lengths" | "clamped";
  /** Days the first period has run. */
  elapsedDays: number;
  /** Set when the earlier month/year was shorter than the elapsed days and the range stopped at its last day. */
  clamped: null | { requestedDays: number; usedDays: number };
  /** First period minus second, exactly as `difference`. */
  absoluteChange: string;
  /** One decimal place, e.g. "-66.7"; null unless `percentOutcome` is "changed" or "no-change". */
  percentChange: string | null;
  percentOutcome: PercentOutcome;
};

export type AskVaultSnapshotV2 = {
  contractVersion: 2;
  context: { generation: number; sessionRevision: number };
  revision: AskDataRevision;
  asOf: string;
  /** Date of the first recorded transaction in the whole ledger, or null when the ledger is empty. Informational only: it is never proof that earlier or later months are complete. */
  earliestRecord: string | null;
  kind: AskKind;
  spendingBasis: "gross-negative-allocations";
  thresholdBasis: "absolute-parent-amount";
  periods: PeriodResultV2[];
  difference: string | null;
  comparison: AskComparison | null;
};

/** Limits (shared with M1): at most 20 account ids + category names + member ids together; groups shown at most 50. */
export const LIMITS = { selected: 20, groups: 50, topN: 50 } as const;
