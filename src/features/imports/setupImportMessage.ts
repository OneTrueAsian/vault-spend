import type { SetupImportPreview, SetupImportSummary } from "../../shared/lib/types";

/** True when the file has no rows to import and none that failed either, so there is nothing to review. */
export function setupPreviewHasNothingToShow(preview: SetupImportPreview): boolean {
  return (
    preview.accounts.length + preview.categories.length + preview.budgets.length + preview.buckets.length + preview.holdings.length === 0 &&
    preview.row_problems.length === 0
  );
}

export function emptySetupMessage(): string {
  return "Nothing importable found in that file — is it a filled-in setup template?";
}

export function setupImportMessage(summary: SetupImportSummary): string {
  const parts = [
    `${summary.accounts_created} account${summary.accounts_created === 1 ? "" : "s"}`,
    `${summary.categories_created} categor${summary.categories_created === 1 ? "y" : "ies"}`,
    `${summary.budgets_set} budget line${summary.budgets_set === 1 ? "" : "s"}`,
    `${summary.buckets_created} goal${summary.buckets_created === 1 ? "" : "s"}`,
    `${summary.holdings_created} holding${summary.holdings_created === 1 ? "" : "s"}`,
  ];
  let message = `Setup import done: ${parts.join(", ")}.`;
  if (summary.skipped.length > 0) message += ` Skipped: ${summary.skipped.join("; ")}.`;
  if (summary.row_errors > 0) message += ` ${summary.row_errors} row${summary.row_errors === 1 ? " had errors and was" : "s had errors and were"} ignored.`;
  return message;
}
