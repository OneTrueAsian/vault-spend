import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultCategoryChoices, type CategoryChoice } from "./ImportCategoryReconcile";
import {
  carryOverReview,
  leaveRestUncategorized,
  pruneRowChoices,
  rowChoicesToSend,
  seedAccountOverrides,
  unresolvedRows,
  type ImportPreview,
  type RowChoices,
} from "./importResolution";
import { errorMessage } from "./errorMessage";
import type { ImportSummary, PendingImport, StatusKind } from "./appTypes";
import type { Account } from "./types";

/** The Transactions tab's import review: the file being reviewed, which rows are checked, any
 * account changed per row, the choice for each unfamiliar file category, and the person's category
 * for each row the app couldn't place — with everything that reads or changes them. The file
 * picker and the sign question stay with the page; `begin` takes over once they are answered. */
export function useImportReview({
  accounts,
  busy,
  setBusy,
  setStatus,
  refresh,
  onImported,
}: {
  accounts: Account[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setStatus: (text: string, kind?: StatusKind) => void;
  refresh: () => Promise<void>;
  /** The new transactions' ids, once the list has been read back (the page opens its review inbox on them). */
  onImported: (ids: number[]) => void;
}) {
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [includedIndices, setIncludedIndices] = useState<Set<number>>(new Set());
  const [accountOverrides, setAccountOverrides] = useState<Map<number, number>>(new Map());
  // What to do with each category the file uses that the person doesn't have (see
  // ImportCategoryReconcile). Each starts on the person's choice from an earlier import, or
  // "Let the app guess" (adds nothing to their list), so an import that
  // isn't reviewed closely adds nothing to their category list.
  const [importCategoryChoices, setImportCategoryChoices] = useState<Record<string, CategoryChoice>>({});
  // The person's category for each row the app couldn't place (see ImportNeedsChoice): a category,
  // or null for "Leave uncategorized". A row with no entry has no choice yet.
  const [importRowChoices, setImportRowChoices] = useState<RowChoices>(new Map());
  // Why the last Import was refused. Shown inside the review: a status message would sit behind
  // the dialog's dimmed backdrop, out of sight.
  const [notice, setNotice] = useState<string | null>(null);

  /** Reads `path` and opens its review. */
  async function begin(path: string, invertAmounts: boolean, accountId: number) {
    setBusy(true);
    setStatus("Reading file…", "info");
    try {
      const preview = await invoke<ImportPreview>("preview_import", {
        path,
        invertAmounts,
        accountId,
      });
      // duplicates default to excluded (matches the old behavior), everything
      // else defaults to included; the user can flip any row either way
      setIncludedIndices(new Set(preview.rows.filter((r) => !r.is_duplicate).map((r) => r.index)));
      // A row whose file said which account it belongs to (this app's own
      // Transactions CSV export does) pre-selects that account in its dropdown
      // when it matches one that already exists, rather than defaulting
      // every row to the account picked before the file was chosen — the
      // user still sees exactly what will happen and can change it.
      // Unmatched account names (commit_import creates those fresh) are
      // left showing the default, with a hint below the dropdown instead.
      setAccountOverrides(seedAccountOverrides(preview, accounts, accountId));
      setImportCategoryChoices(defaultCategoryChoices(preview.unmatched_categories));
      setImportRowChoices(new Map());
      setNotice(null);
      setPendingImport({ path, invertAmounts, defaultAccountId: accountId, preview });
      setStatus("");
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleIncluded(index: number) {
    setIncludedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function toggleSelectAllImportRows() {
    if (!pendingImport) return;
    const rows = pendingImport.preview.rows;
    const allIncluded = rows.length > 0 && rows.every((r) => includedIndices.has(r.index));
    setIncludedIndices(allIncluded ? new Set() : new Set(rows.map((r) => r.index)));
  }

  function setImportRowAccount(index: number, accountId: number) {
    if (!pendingImport) return;
    setAccountOverrides((prev) => {
      const next = new Map(prev);
      if (accountId === pendingImport.defaultAccountId) {
        next.delete(index); // matches the default again — no override needed
      } else {
        next.set(index, accountId);
      }
      return next;
    });
  }

  function clearPendingImport() {
    setPendingImport(null);
    setIncludedIndices(new Set());
    setAccountOverrides(new Map());
    setImportCategoryChoices({});
    setImportRowChoices(new Map());
    setNotice(null);
  }

  /** A change to the unfamiliar-category panel; a row it now settles drops its own choice. */
  function updateImportCategoryChoices(next: Record<string, CategoryChoice>) {
    setImportCategoryChoices(next);
    if (pendingImport) {
      const { rows, choice_below } = pendingImport.preview;
      setImportRowChoices((prev) => pruneRowChoices(rows, next, prev, choice_below));
    }
  }

  /** "Leave the rest uncategorized" on the Needs your choice list. */
  function leaveRestOfRowsUncategorized() {
    if (!pendingImport) return;
    setImportRowChoices((prev) =>
      leaveRestUncategorized(pendingImport.preview.rows, includedIndices, importCategoryChoices, prev, pendingImport.preview.choice_below),
    );
  }

  async function confirmPendingImport() {
    if (!pendingImport || busy) return;
    const { rows, choice_below } = pendingImport.preview;
    // Import is off until every checked row is settled; this is the same check, in case it is reached another way.
    if (includedIndices.size === 0 || unresolvedRows(rows, includedIndices, importCategoryChoices, importRowChoices, choice_below).length > 0) return;
    setBusy(true);
    setNotice(null);
    setStatus("Importing…", "info");
    const totalRows = rows.length;
    const includedCount = includedIndices.size;
    let summary: ImportSummary;
    try {
      summary = await invoke<ImportSummary>("commit_import", {
        path: pendingImport.path,
        invertAmounts: pendingImport.invertAmounts,
        defaultAccountId: pendingImport.defaultAccountId,
        reviewToken: pendingImport.preview.review_token,
        includedIndices: Array.from(includedIndices),
        accountOverrides: Object.fromEntries(accountOverrides),
        categoryChoices: importCategoryChoices,
        rowChoices: rowChoicesToSend(rows, includedIndices, importCategoryChoices, importRowChoices, choice_below),
      });
    } catch (e) {
      // Nothing was saved. Something may have changed since the review was opened (the file, or a
      // category deleted elsewhere), so the file is read again and every choice that still applies
      // is kept; the person checks the updated review and tries again.
      const message = errorMessage(e);
      try {
        const next = await invoke<ImportPreview>("preview_import", {
          path: pendingImport.path,
          invertAmounts: pendingImport.invertAmounts,
          accountId: pendingImport.defaultAccountId,
        });
        const categories = await invoke<string[]>("list_categories");
        const carried = carryOverReview(
          {
            preview: pendingImport.preview,
            defaultAccountId: pendingImport.defaultAccountId,
            included: includedIndices,
            panel: importCategoryChoices,
            rowChoices: importRowChoices,
            accountOverrides,
          },
          next,
          categories,
          accounts,
        );
        setPendingImport({ ...pendingImport, preview: next });
        setIncludedIndices(carried.included);
        setImportCategoryChoices(carried.panel);
        setImportRowChoices(carried.rowChoices);
        setAccountOverrides(carried.accountOverrides);
        setStatus("");
        setNotice(`${message} The review has been updated${carried.fileChanged ? " from the changed file" : ""}. Check it and import again.`);
        // So the category menus match what the review was just checked against; the review itself
        // is already updated, so a failed list reload here only leaves the menus as they were.
        refresh().catch(() => undefined);
      } catch {
        setStatus("");
        setNotice(message);
      }
      setBusy(false);
      return;
    }
    // Saved. The review closes now, so the same file can't be imported twice by accident.
    clearPendingImport();
    const skipped = totalRows - includedCount;
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const imported =
      `Imported ${count(summary.inserted, "transaction", "transactions")}` +
      (skipped ? ` — ${skipped} left out` : "") +
      (summary.auto_linked ? ` — linked ${count(summary.auto_linked, "transfer", "transfers")} automatically` : "") +
      (summary.row_errors ? ` — ${count(summary.row_errors, "row", "rows")} couldn't be read` : "");
    try {
      await refresh();
      if (summary.inserted_ids.length > 0) onImported(summary.inserted_ids);
      setStatus(imported, summary.row_errors ? "error" : "success");
    } catch (e) {
      setStatus(`${imported}. The list couldn't be updated: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function cancelPendingImport() {
    clearPendingImport();
    setStatus("Import cancelled.", "info");
  }

  return {
    pendingImport,
    includedIndices,
    accountOverrides,
    importCategoryChoices,
    importRowChoices,
    setImportRowChoices,
    begin,
    toggleIncluded,
    toggleSelectAllImportRows,
    setImportRowAccount,
    updateImportCategoryChoices,
    leaveRestOfRowsUncategorized,
    confirmPendingImport,
    cancelPendingImport,
    notice,
  };
}

export type ImportReview = ReturnType<typeof useImportReview>;
