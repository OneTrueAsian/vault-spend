export type Asset = {
  id: number;
  name: string;
  asset_type: string;
  value: string;
  valued_on: string;
  notes: string | null;
  member_id: number | null;
  member_name: string | null;
};

export type FamilyMember = {
  id: number;
  name: string;
};

export type ForecastPoint = {
  date: string;
  balance: string;
};

/** One dated Recurring bill (negative) or paycheck (positive) the
 * bill-aware forecast places on its due date. */
export type ForecastEvent = {
  date: string;
  label: string;
  amount: string;
};

export type BillAwareForecast = {
  /** `false` when Recurring has nothing active, so `points` is just the plain
   * trend forecast. */
  uses_recurring: boolean;
  /** Cash (checking + savings) in the accounts right now. */
  start_balance: string;
  points: ForecastPoint[];
  events: ForecastEvent[];
  /** Net everyday cash flow per day outside recurring items and transfers. */
  daily_baseline: string;
};

export type Backup = {
  filename: string;
  created_at: string;
  size_bytes: number;
};

export type Profile = {
  id: string;
  name: string;
  is_active: boolean;
  icon_key: string | null;
};

export type LivePriceProviderId = "alpha_vantage" | "finnhub" | "twelve_data" | "stockdata_org";

export type LivePriceSettings = {
  enabled: boolean;
  provider: LivePriceProviderId;
  last_refreshed_at: string | null;
  requests_used_today: number;
  requests_limit: number | null;
};

export type LivePriceRefreshSummary = {
  updated: string[];
  failed: { symbol: string; error: string }[];
};

export type AppSettings = {
  apply_to_debt_enabled: boolean;
  split_purchases_enabled: boolean;
  envelope_caps_enabled: boolean;
  /** The global "Rollover unspent" switch; off stops any unspent budget carrying into a later month. */
  rollover_enabled: boolean;
  /** Opt-in (off by default): link clear-cut transfer pairs automatically. */
  auto_link_transfers: boolean;
};

/** Purely a per-viewer display preference (like `Theme` in App.tsx) — stored
 * in localStorage, never sent to the backend. All three styles follow the
 * header's separate Light/Dark/System toggle — none of them is dark-only. */
export type ThemeStyle = "classic" | "futuristic" | "transparent";

export type Insight = {
  severity: "warning" | "info" | "positive";
  kind: "pace" | "category_jump" | "category_drop" | "large_expense";
  message: string;
};

export type AppliedDebtPayment = {
  debt_account_id: number;
  debt_account_name: string;
  amount: string;
};

export type Transaction = {
  id: number;
  /** The other leg's id when this is one half of a linked transfer between
   * the user's own accounts (see `Store::link_transfer`); `null` otherwise. */
  transfer_counterpart_id: number | null;
  date: string;
  description: string;
  amount: string;
  category: string | null;
  category_source: "rule" | "user" | "classifier" | null;
  confidence: number | null;
  account_id: number;
  account_name: string;
  applied_to_debt: AppliedDebtPayment | null;
  principal_amount: string | null;
  split_count: number;
  tags: string[];
  member_id: number | null;
  member_name: string | null;
};

export type TransactionSplit = {
  id: number;
  category: string | null;
  amount: string;
  note: string | null;
};

export type Account = {
  id: number;
  name: string;
  account_type: string;
  starting_balance: string;
  current_balance: string;
  institution: string | null;
  mask: string | null;
  interest_rate: string | null;
  excluded_from_debt_payoff: boolean;
  member_id: number | null;
  member_name: string | null;
  /** A transaction dated on or before this can't move `current_balance` —
   * the account's last monthly rollover or manual balance correction
   * already accounts for everything through this date. `null` if neither
   * has ever happened for this account. */
  checkpoint_date: string | null;
  /** An explicit icon override (see `AccountTypeIcon`'s `iconKey` prop) —
   * `null` means "keep guessing an icon from `account_type`." */
  icon_key: string | null;
};

/** A registered category name plus its explicit icon override, if any —
 * returned by `list_categories_with_icons` alongside (not instead of) the
 * plain `list_categories(): string[]` most of the app still uses for
 * name-only pickers/autocomplete. */
export type CategoryIconEntry = {
  name: string;
  icon_key: string | null;
};

export type DebtPayoffLine = {
  account_id: number;
  account_name: string;
  starting_balance: string;
  payoff_date: string | null;
  total_interest_paid: string;
};

export type DebtPayoffPlan = {
  per_account: DebtPayoffLine[];
  total_months: number | null;
  total_interest_paid: string;
};

export type Bucket = {
  id: number;
  name: string;
  target_amount: string | null;
  saved_amount: string;
  target_date: string | null;
  account_id: number | null;
  account_name: string | null;
  member_id: number | null;
  member_name: string | null;
  sinking_amount: string | null;
  color: string | null;
  icon_key: string | null;
  /** Progress follows the linked account's balance instead of contributions. */
  tracks_account: boolean;
  /** Net dollars per month gained over the trailing 90 days. */
  monthly_pace: string;
};

export type SinkingFundContribution = {
  bucket_id: number;
  bucket_name: string;
  amount: string;
};

export type MemberBudgetActual = {
  category: string;
  budget_group: string;
  budgeted: string;
  member_id: number | null;
  member_name: string | null;
  actual: string;
};

export type BudgetGroup = "income" | "fixed" | "flexible" | "nonmonthly";

export type ReportBudgetLine = {
  category: string;
  budget_group: string;
  budgeted: string;
  actual: string;
  cap_enabled: boolean;
  /** Unspent budget carried in from earlier months; "0" unless rollover is on. */
  rollover: string;
  rollover_enabled: boolean;
};

/** What the month-end review walks through — `Store::month_review`. */
export type MonthReview = {
  year: number;
  month: number;
  income: string;
  /** Spending, as a positive number. */
  expenses: string;
  prev_income: string;
  prev_expenses: string;
  over_budget: { category: string; budgeted: string; actual: string }[];
  uncategorized_count: number;
  uncategorized_total: string;
  reviewed: boolean;
};

/** One row of the Budget page's "suggest from my 3-month average" preview. */
export type BudgetSuggestion = {
  category: string;
  budget_group: string;
  /** What the month already budgets for it; null when it has no line yet. */
  current: string | null;
  /** Average monthly spend over the window, a whole-dollar amount. */
  suggested: string;
};

export type BudgetSuggestions = {
  /** Whole months the averages cover — fewer than 3 when history is short. */
  months_used: number;
  lines: BudgetSuggestion[];
};

export type Recurring = {
  id: number;
  merchant: string;
  category: string | null;
  amount: string;
  cadence: string;
  anchor_date: string;
  next_date: string;
  account_id: number | null;
  account_name: string | null;
  member_id: number | null;
  member_name: string | null;
  status: "keep" | "reviewing" | "canceled";
};

/** How one recurring item lines up with the transactions actually posted —
 * `Store::recurring_matches`. */
export type RecurringMatch = {
  recurring_id: number;
  /** "paid" | "pending" | "missed" | "unmatched" | "upcoming" */
  state: "paid" | "pending" | "missed" | "unmatched" | "upcoming";
  /** Latest due date on or before today. */
  last_due: string | null;
  last_paid_date: string | null;
  last_paid_amount: string | null;
  /** Signed like the item itself (a bill is negative). */
  price_change: { from: string; to: string } | null;
};

export type RecurringTotals = {
  monthly_expense: string;
  monthly_income: string;
  annual_expense: string;
  annual_income: string;
};

export type RecurringCandidate = {
  merchant: string;
  category: string | null;
  amount: string;
  cadence: string;
  anchor_date: string;
  occurrence_count: number;
};

export type Holding = {
  id: number;
  account_id: number;
  account_name: string;
  symbol: string;
  name: string;
  shares: string;
  price: string;
  cost_basis: string;
  asset_class: string | null;
  value: string;
  gain_loss: string;
  prev_close: string | null;
  day_gain_loss: string | null;
};

/** The opt-in tray icon / background reminders — `get_background_settings`. */
export type BackgroundSettings = {
  tray_enabled: boolean;
  autostart_enabled: boolean;
  /** Whether "start when I sign in" can be switched on on this platform. */
  autostart_supported: boolean;
};

/** One recorded day of the portfolio's total value — `Store::portfolio_history`. */
export type PortfolioPoint = {
  date: string;
  value: string;
};

/** The share of the portfolio wanted in an asset class. */
export type AllocationTarget = {
  asset_class: string;
  /** A percentage, "0"-"100". */
  percent: string;
};

export type MonthTotal = {
  month_label: string;
  year: number;
  month: number;
  income: string;
  expense: string;
};

export type CategoryAmount = {
  category: string;
  amount: string;
};

export type MerchantAmount = {
  description: string;
  amount: string;
};

export type YoyCashFlow = {
  current: MonthTotal[];
  prior_year: MonthTotal[];
};

export type CashFlow = {
  months: MonthTotal[];
  top_categories: CategoryAmount[];
  top_merchants: MerchantAmount[];
  total_income: string;
  total_expense: string;
};

export type LargeExpense = {
  transaction_id: number;
  date: string;
  description: string;
  amount: string;
  category: string | null;
  detail: string;
};

export type MonthExpenseDetail = {
  month_label: string;
  categories: CategoryAmount[];
  large_expenses: LargeExpense[];
};

export type CategoryTransaction = {
  transaction_id: number;
  date: string;
  description: string;
  amount: string;
  account_name: string;
  is_split: boolean;
  split_note: string | null;
};

export type NetWorthPoint = {
  month_label: string;
  value: string;
  cash: string;
  debt: string;
  investments: string;
  as_of: string;
};

/** Per-account movement in net-worth contribution between two `NetWorthPoint.as_of`
 * dates — the "what changed" behind a Dashboard stat card's trend. See
 * `Store::account_contribution_deltas` on the backend. */
export type AccountContributionDelta = {
  account_id: number;
  name: string;
  group: string;
  from_amount: string;
  to_amount: string;
  delta: string;
};

export type Report = {
  total_saved: string;
  income_total: string;
  month_label: string;
  budget_actuals: ReportBudgetLine[];
};

export type RolledAccount = {
  account_id: number;
  account_name: string;
  new_balance: string;
};

export type BudgetAlert = {
  category: string;
  budget_group: string;
  budgeted: string;
  actual: string;
  pct: string;
  level: "warning" | "over";
  cap_enabled: boolean;
};

export type AnomalyFlag = {
  transaction_id: number;
  kind: "large" | "duplicate";
  detail: string;
};

export type SetupAccountRow = {
  index: number;
  name: string;
  account_type: string;
  starting_balance: string | null;
  institution: string | null;
  mask: string | null;
  already_exists: boolean;
};

export type SetupCategoryRow = {
  index: number;
  name: string;
  already_exists: boolean;
};

export type SetupBudgetRow = {
  index: number;
  category: string;
  budget_group: string;
  monthly_amount: string;
  period: string | null;
  will_update: boolean;
};

export type SetupBucketRow = {
  index: number;
  name: string;
  target_amount: string | null;
  target_date: string | null;
  linked_account_name: string | null;
  already_exists: boolean;
};

export type SetupHoldingRow = {
  index: number;
  account_name: string;
  symbol: string;
  name: string | null;
  shares: string;
  price: string;
  cost_basis: string;
  asset_class: string | null;
  account_found: boolean;
};

export type SetupImportPreview = {
  accounts: SetupAccountRow[];
  categories: SetupCategoryRow[];
  budgets: SetupBudgetRow[];
  buckets: SetupBucketRow[];
  holdings: SetupHoldingRow[];
  row_errors: number;
};

export type SetupImportSummary = {
  accounts_created: number;
  categories_created: number;
  budgets_set: number;
  buckets_created: number;
  holdings_created: number;
  skipped: string[];
  row_errors: number;
};
