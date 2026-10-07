/** Types and fixed lists the app shell (App.tsx) shares with the pieces split out of it. */

import type { ImportPreview } from "./importResolution";
import type { ImportSignSuggestion } from "./importSigns";

export type ImportSummary = {
  inserted: number;
  row_errors: number;
  inserted_ids: number[];
  /** Transfer pairs linked automatically by this import (0 unless auto-linking is on). */
  auto_linked: number;
};

export type PendingImport = {
  path: string;
  invertAmounts: boolean;
  defaultAccountId: number;
  preview: ImportPreview;
};

export type Stats = {
  total: number;
  auto_categorized: number;
  user_confirmed: number;
  uncategorized: number;
};

export type NewAccountResult = {
  name: string;
  accountType: string;
  startingBalance: string | null;
  institution: string | null;
  mask: string | null;
  memberId: number | null;
  iconKey: string | null;
};

export type PendingDialog =
  | {
    kind: "newAccount";
    resolve: (result: NewAccountResult | null) => void;
  }
  | { kind: "newCategory"; resolve: (name: string | null) => void }
  | { kind: "confirmInvert"; resolve: (invert: boolean) => void; accountName?: string; suggestion?: ImportSignSuggestion }
  | { kind: "csvExportWarning"; resolve: (proceed: boolean) => void };

/** How a transaction got its category, in words (the backend stores rule / user / classifier). */
export const CATEGORY_SOURCE_LABELS: Record<string, string> = { rule: "Your rule", user: "You", classifier: "Suggested" };

export type Tab =
  | "dashboard"
  | "accounts"
  | "ledger"
  | "buckets"
  | "budget"
  | "cashflow"
  | "reports"
  | "recurring"
  | "investments"
  | "household"
  | "settings"
  | "help";

/** Groups the sidebar organizes its (reorderable) tabs under — Settings
 * and Help are pinned below these instead of belonging to a group, so
 * they're never part of the drag-to-reorder set (see `PINNED_NAV_ITEMS`). */
export type NavGroup = "overview" | "money" | "planning" | "insights";
export const NAV_GROUP_ORDER: NavGroup[] = ["overview", "money", "planning", "insights"];
export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  overview: "Overview",
  money: "Money",
  planning: "Planning",
  insights: "Insights",
};

export type Theme = "light" | "dark" | "system";

export type StatusKind = "success" | "error" | "info";

export type LedgerSortColumn = "date" | "description" | "amount" | "account" | "category" | "source";

/** The sidebar's reorderable tabs — grouped for display (see `NavGroup`)
 * but reordered as one flat sequence via drag-and-drop; rendering then
 * re-partitions that sequence by `group`, so a drag effectively only ever
 * reorders within its own group (dropping across a group boundary changes
 * the stored order but never moves an item out of its group visually) —
 * this keeps the mental model of the grouped redesign intact without
 * needing separate per-group order state. Settings and Help are pinned
 * outside this entirely (see `PINNED_NAV_ITEMS`), not reorderable. */
export const NAV_ITEMS: { id: Tab; label: string; icon: string; group: NavGroup }[] = [
  { id: "dashboard", label: "Dashboard", icon: "home", group: "overview" },
  { id: "accounts", label: "Accounts", icon: "bank", group: "money" },
  { id: "ledger", label: "Transactions", icon: "swap", group: "money" },
  { id: "recurring", label: "Recurring", icon: "repeat", group: "money" },
  { id: "budget", label: "Budget", icon: "pie", group: "planning" },
  { id: "buckets", label: "Goals", icon: "flag", group: "planning" },
  { id: "cashflow", label: "Cash Flow", icon: "trend", group: "insights" },
  { id: "investments", label: "Investments", icon: "barchart", group: "insights" },
  { id: "household", label: "Household", icon: "users", group: "insights" },
  { id: "reports", label: "Reports", icon: "wallet", group: "insights" },
];

/** Fixed, non-reorderable — rendered below a divider, outside every
 * group. */
export const PINNED_NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "help", label: "Help", icon: "help" },
];

/** Sentinel `filterCategory` value meaning "no category assigned" — kept
 * distinct from any real category name the same way the per-row category
 * `<select>`s already use `"__new__"` for "+ New category…". */
export const UNCATEGORIZED_FILTER = "__uncategorized__";

/** A named snapshot of the Transactions tab's filter bar — a per-viewer shortcut,
 * same localStorage tier as theme/nav order. `filterAccountIds`/
 * `filterMemberIds` are stored as plain arrays (`Set` doesn't survive
 * `JSON.stringify`) and rehydrated back to `Set`s on apply — see
 * `applySavedFilter`. A saved account/category/tag that's since been
 * deleted just matches nothing once applied, the same as typing a filter
 * that happens to match zero rows — nothing here needs it to still exist. */
export type SavedLedgerFilter = {
  name: string;
  searchText: string;
  filterCategory: string;
  filterAccountIds: number[] | "all";
  filterMemberIds: number[] | "all";
  filterFrom: string;
  filterTo: string;
  filterTag: string;
};
