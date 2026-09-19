/** The 9 always-available Dashboard widgets, plus the 4 report sections
 * that can also be pinned onto the Dashboard from their home tab (Cash
 * Flow, Investments, Reports). "Pinning" and picking a widget from the
 * "+ Add widget" modal are the same operation — both just add the id to
 * the current layout — so there's no separate "unlocked" concept to track. */
export type CoreWidgetId =
  | "stat_net_worth"
  | "stat_cash"
  | "stat_debt"
  | "stat_investments"
  | "runway"
  | "safe_to_spend"
  | "needs_a_look"
  | "trend_spending"
  | "budget_bills"
  | "recent_transactions";

export type PinnedReportWidgetId = "top_merchants" | "debt_payoff" | "allocation" | "net_worth_by_member";

/** The fixed, always-the-same-shape widgets — the ones `WIDGET_CATALOG`
 * and `LAYOUT_PRESETS` enumerate. */
export type FixedWidgetId = CoreWidgetId | PinnedReportWidgetId;

/** A widget scoped to one specific account/bucket/investment account,
 * chosen by the user from the "+ Add widget" dialog rather than picked
 * from the fixed catalog. Holdings have no `account_id` (InvestmentsView
 * already groups them by `account_name`), so investment widgets key by
 * name — the same string that page already treats as the account's
 * identity. */
export type AccountWidgetId = `account:${number}`;
export type BucketWidgetId = `bucket:${number}`;
export type InvestmentWidgetId = `investment:${string}`;

export type WidgetId = FixedWidgetId | AccountWidgetId | BucketWidgetId | InvestmentWidgetId;

export function accountWidgetId(accountId: number): AccountWidgetId {
  return `account:${accountId}`;
}
export function bucketWidgetId(bucketId: number): BucketWidgetId {
  return `bucket:${bucketId}`;
}
export function investmentWidgetId(accountName: string): InvestmentWidgetId {
  return `investment:${accountName}`;
}

export function parseWidgetId(
  id: WidgetId,
):
  | { kind: "fixed"; id: FixedWidgetId }
  | { kind: "account"; targetId: number }
  | { kind: "bucket"; targetId: number }
  | { kind: "investment"; accountName: string } {
  if (id.startsWith("account:")) return { kind: "account", targetId: Number(id.slice("account:".length)) };
  if (id.startsWith("bucket:")) return { kind: "bucket", targetId: Number(id.slice("bucket:".length)) };
  if (id.startsWith("investment:")) return { kind: "investment", accountName: id.slice("investment:".length) };
  return { kind: "fixed", id: id as FixedWidgetId };
}

/** The 4 stat-card widgets — kept as one contiguous list so DashboardView
 * can lay out however many of them are still on the layout, and adjacent to
 * each other, as one shared row instead of 4 full-width stacked cards. */
export const STAT_WIDGET_IDS: readonly WidgetId[] = ["stat_net_worth", "stat_cash", "stat_debt", "stat_investments"];

export const WIDGET_CATALOG: { id: FixedWidgetId; label: string; group: "core" | "report" }[] = [
  { id: "stat_net_worth", label: "Net Worth", group: "core" },
  { id: "stat_cash", label: "Cash", group: "core" },
  { id: "stat_debt", label: "Debt", group: "core" },
  { id: "stat_investments", label: "Investments", group: "core" },
  { id: "runway", label: "Runway", group: "core" },
  { id: "safe_to_spend", label: "Safe to spend", group: "core" },
  { id: "needs_a_look", label: "Needs a look", group: "core" },
  { id: "trend_spending", label: "Trend & spending", group: "core" },
  { id: "budget_bills", label: "Budget & bills", group: "core" },
  { id: "recent_transactions", label: "Recent transactions", group: "core" },
  { id: "top_merchants", label: "Top merchants", group: "report" },
  { id: "debt_payoff", label: "Debt payoff planner", group: "report" },
  { id: "allocation", label: "Allocation", group: "report" },
  { id: "net_worth_by_member", label: "Net worth by member", group: "report" },
];

const CATALOG_IDS = new Set(WIDGET_CATALOG.map((w) => w.id));

/** A saved id is either one of the fixed catalog entries, or a
 * well-formed reference to a specific account/bucket/investment account.
 * Whether that *target* still exists is checked at render time
 * (DashboardView has the live data; this module doesn't) — a dead
 * reference is pruned from the saved layout once App.tsx notices the
 * target is gone. */
function isValidWidgetId(id: unknown): id is WidgetId {
  if (typeof id !== "string") return false;
  if (CATALOG_IDS.has(id as FixedWidgetId)) return true;
  if (/^(account|bucket):\d+$/.test(id)) return true;
  if (/^investment:.+$/.test(id)) return true;
  return false;
}

export const DEFAULT_LAYOUT: WidgetId[] = [
  "stat_net_worth",
  "stat_cash",
  "stat_debt",
  "stat_investments",
  "runway",
  "safe_to_spend",
  "needs_a_look",
  "trend_spending",
  "budget_bills",
  "recent_transactions",
];

export const LAYOUT_PRESETS = {
  default: DEFAULT_LAYOUT,
  bills_focus: [
    "stat_net_worth",
    "stat_cash",
    "stat_debt",
    "stat_investments",
    "safe_to_spend",
    "needs_a_look",
    "budget_bills",
    "debt_payoff",
    "recent_transactions",
  ],
  investor_focus: [
    "stat_net_worth",
    "stat_cash",
    "stat_debt",
    "stat_investments",
    "trend_spending",
    "allocation",
    "net_worth_by_member",
    "runway",
  ],
} satisfies Record<string, WidgetId[]>;

export type LayoutPresetKey = keyof typeof LAYOUT_PRESETS;

export const LAYOUT_PRESET_LABELS: Record<LayoutPresetKey, string> = {
  default: "Default",
  bills_focus: "Bills Focus",
  investor_focus: "Investor Focus",
};

const STORAGE_KEY = "meadow-dashboard-layout";

/** Same try/parse/catch-fallback shape as `loadNavOrder`/`theme` in
 * App.tsx — a per-viewer arrangement, not app data, so it lives in
 * localStorage. Drops any id from a future/older version of the catalog
 * this build doesn't recognize, rather than erroring. A saved layout from
 * before the stat cards were split back out carries the single legacy
 * "stats" id — expanded in place into the 4 new ids so an upgrading user's
 * arrangement doesn't just lose its stat row. */
export function loadDashboardLayout(): WidgetId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT;
    const expanded = parsed.flatMap((id) => (id === "stats" ? STAT_WIDGET_IDS : [id]));
    const filtered = expanded.filter(isValidWidgetId);
    return filtered.length > 0 ? filtered : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveDashboardLayout(widgets: WidgetId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}

/** A user-named arrangement, saved alongside the 3 built-in presets —
 * same idea as `SavedLedgerFilter` in App.tsx (a per-viewer localStorage
 * list keyed by name, where saving under a name already in use replaces
 * it rather than accumulating duplicates). Its dropdown `<option value>`
 * is `custom:${name}` — see `matchingLayoutPreset` below. */
export type SavedLayoutPreset = { name: string; widgets: WidgetId[] };

const CUSTOM_PRESETS_STORAGE_KEY = "meadow-dashboard-custom-layouts";

export function loadCustomLayoutPresets(): SavedLayoutPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is SavedLayoutPreset =>
          !!p && typeof p === "object" && typeof (p as SavedLayoutPreset).name === "string" &&
          Array.isArray((p as SavedLayoutPreset).widgets),
      )
      .map((p) => ({ name: p.name, widgets: p.widgets.filter(isValidWidgetId) }))
      .filter((p) => p.widgets.length > 0);
  } catch {
    return [];
  }
}

export function saveCustomLayoutPresets(presets: SavedLayoutPreset[]) {
  try {
    localStorage.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}

/** Which named preset (if any) the current layout exactly matches, by
 * order and contents — used to drive the Layout dropdown's selected value
 * and its "Custom (unsaved)" fallback. Purely derived from `widgets`
 * rather than tracked as its own piece of state, so there's no way for it
 * to drift out of sync with a hand-edited layout. Checks the 3 built-in
 * presets first, then any saved custom ones (returned as `custom:${name}`,
 * matching their dropdown `<option value>`). */
export function matchingLayoutPreset(
  widgets: WidgetId[],
  customPresets: SavedLayoutPreset[] = [],
): LayoutPresetKey | `custom:${string}` | "custom" {
  for (const key of Object.keys(LAYOUT_PRESETS) as LayoutPresetKey[]) {
    const preset = LAYOUT_PRESETS[key];
    if (preset.length === widgets.length && preset.every((id, i) => id === widgets[i])) {
      return key;
    }
  }
  for (const custom of customPresets) {
    if (custom.widgets.length === widgets.length && custom.widgets.every((id, i) => id === widgets[i])) {
      return `custom:${custom.name}`;
    }
  }
  return "custom";
}
