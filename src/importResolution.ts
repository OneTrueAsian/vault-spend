/** The import review screen's rows, and which of them still need the person's choice of
 * category before the import can be saved. Mirrors the backend's order
 * (`budget_core::import_resolution`, which `commit_import` re-checks): the file's own category
 * when it is one of theirs, else the panel's choice for that file category (use one of theirs,
 * or add it), else a rule or auto-categorizer answer that is sure enough, else the person
 * decides. Pure, so changing a panel choice or a checkbox needs no call to the backend. */

import type { CategoryChoice } from "./ImportCategoryReconcile";

/** What the rules ("rule") or the auto-categorizer ("guess") would file a row under. */
export type Suggestion = {
  category: string;
  source: "rule" | "guess";
  /** How sure, 0 to 1. A plain rule match has none. */
  confidence: number | null;
};

export type ImportRow = {
  index: number;
  date: string;
  description: string;
  amount: string;
  is_duplicate: boolean;
  /** The row's own Account column, when the file has one — this app's own
   * Transactions CSV export does. `commit_import` routes the row there by
   * default (creating that account if none matches by name) unless the
   * row's dropdown is changed. */
  account_name: string | null;
  /** The row's own Category column, when the file has one — the file's name for it, which
   * may not be a category the person has (see `unmatched_categories`). */
  category: string | null;
  /** The person's category the file's one matches, in their spelling. */
  matched_category: string | null;
  /** For every row without a `matched_category`: what the rules or the auto-categorizer suggest. */
  suggestion: Suggestion | null;
};

/** A category name the file uses that isn't one of the person's, and how many rows use it. */
export type UnmatchedCategory = {
  name: string;
  count: number;
  /** The category the person picked for this name on an earlier import, if any. */
  remembered_category?: string | null;
};

export type ImportPreview = {
  rows: ImportRow[];
  row_errors: number;
  /** Category names the file uses that the person doesn't have. Nothing is added for these
   * unless the review screen sends back a "create" choice. */
  unmatched_categories: UnmatchedCategory[];
  /** Sent back to `commit_import`, which refuses a file that changed since this preview. */
  review_token: string;
  /** A suggestion less sure than this needs the person's choice. */
  choice_below: number;
};

/** The person's choice for a row, by row index: a category, or `null` for "Leave uncategorized".
 * A row with no entry has no choice yet. */
export type RowChoices = Map<number, string | null>;

/** A file category name as the backend matches it: trimmed and lower-cased. */
function panelKey(name: string): string {
  return name.trim().toLowerCase();
}

function panelChoiceFor(name: string, panel: Record<string, CategoryChoice>): CategoryChoice | undefined {
  const key = panelKey(name);
  for (const [n, choice] of Object.entries(panel)) {
    if (panelKey(n) === key) return choice;
  }
  return undefined;
}

/** Whether a suggestion is sure enough to file a row without asking. */
export function isSure(suggestion: Suggestion | null, choiceBelow: number): boolean {
  if (!suggestion) return false;
  const c = suggestion.confidence;
  if (c === null) return suggestion.source === "rule";
  return Number.isFinite(c) && c >= choiceBelow && c <= 1;
}

/** Whether the person has to choose this row's category (whatever they have chosen so far). */
export function rowNeedsChoice(row: ImportRow, panel: Record<string, CategoryChoice>, choiceBelow: number): boolean {
  if (row.matched_category) return false;
  if (row.category && row.category.trim()) {
    const choice = panelChoiceFor(row.category, panel);
    if (choice && choice.action !== "skip") return false;
  }
  return !isSure(row.suggestion, choiceBelow);
}

/** The checked rows that need a choice and don't have one yet, in file order. */
export function unresolvedRows(
  rows: ImportRow[],
  included: Set<number>,
  panel: Record<string, CategoryChoice>,
  choices: RowChoices,
  choiceBelow: number,
): ImportRow[] {
  return rows.filter((r) => included.has(r.index) && rowNeedsChoice(r, panel, choiceBelow) && !choices.has(r.index));
}

/** The choices `commit_import` takes: only checked rows that need one (`null` = leave uncategorized). */
export function rowChoicesToSend(
  rows: ImportRow[],
  included: Set<number>,
  panel: Record<string, CategoryChoice>,
  choices: RowChoices,
  choiceBelow: number,
): Record<number, string | null> {
  const out: Record<number, string | null> = {};
  for (const r of rows) {
    if (included.has(r.index) && rowNeedsChoice(r, panel, choiceBelow) && choices.has(r.index)) {
      out[r.index] = choices.get(r.index) ?? null;
    }
  }
  return out;
}

/** Drops the choices of rows that no longer need one (the panel now settles them), so going back
 * to "Let the app guess" asks again. An unchecked row keeps its choice. Returns `choices` itself
 * when nothing changes. */
export function pruneRowChoices(
  rows: ImportRow[],
  panel: Record<string, CategoryChoice>,
  choices: RowChoices,
  choiceBelow: number,
): RowChoices {
  const stale = rows.filter((r) => choices.has(r.index) && !rowNeedsChoice(r, panel, choiceBelow));
  if (stale.length === 0) return choices;
  const next = new Map(choices);
  for (const r of stale) next.delete(r.index);
  return next;
}

/** "Leave the rest uncategorized": every checked row still without a choice gets "Leave
 * uncategorized"; choices already made are kept. */
export function leaveRestUncategorized(
  rows: ImportRow[],
  included: Set<number>,
  panel: Record<string, CategoryChoice>,
  choices: RowChoices,
  choiceBelow: number,
): RowChoices {
  const next = new Map(choices);
  for (const r of unresolvedRows(rows, included, panel, choices, choiceBelow)) next.set(r.index, null);
  return next;
}
