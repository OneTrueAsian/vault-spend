import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultCategoryChoices, type CategoryChoice } from "../../shared/ui/ImportCategoryReconcile";
import {
  carryOverReview,
  initiallyIncluded,
  leaveRestUncategorized,
  pruneRowChoices,
  rowChoicesToSend,
  seedAccountOverrides,
  unresolvedRows,
  type ImportPreview,
  type RowChoices,
} from "../../shared/lib/importResolution";
import { errorMessage } from "../../shared/lib/errorMessage";
import type { FolderImportSource, ImportSummary, PendingImport, StatusKind } from "../../shared/native/appTypes";
import { inspectionWithMap, type ColumnInspection, type ColumnMap, type ColumnMapSource } from "../../shared/lib/columnMapping";
import type { Account } from "../../shared/lib/types";

/** Where a review's rows come from: a picked file, or a watched folder's saved export (VS-102). */
type ReviewSource = { kind: "file"; path: string } | { kind: "folder"; batchId: number };

/** What `preview_folder_import` returns about the saved export alongside its preview. */
type FolderBatchReply = { id: number; row_version: number; file_name: string; source_present: boolean };

function sourceOf(pending: PendingImport): ReviewSource {
  return pending.folder ? { kind: "folder", batchId: pending.folder.batchId } : { kind: "file", path: pending.path };
}

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
  onFolderChanged,
  call = invoke,
}: {
  accounts: Account[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setStatus: (text: string, kind?: StatusKind) => void;
  refresh: () => Promise<void>;
  /** The new transactions' ids, once the list has been read back (the page opens its review inbox on them). */
  onImported: (ids: number[]) => void;
  /** A folder export was imported, or its review closed: the page reads the folder queue again. */
  onFolderChanged?: () => void;
  call?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
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
  // "Use this for future exports with this name", offered once a folder export's signs are flipped.
  const [rememberSigns, setRememberSigns] = useState(false);

  /** Reads the source's rows with these choices (the same call both routes' review and retry use). */
  async function readPreview(
    source: ReviewSource,
    invertAmounts: boolean,
    accountId: number,
    columnMap: ColumnMap | null,
    columns: { inspection: ColumnInspection; source: ColumnMapSource } | null,
  ): Promise<{ preview: ImportPreview; folder: Omit<FolderImportSource, "nameInvert"> | null }> {
    const columnHeaders = columnMap && columns ? columns.inspection.headers : null;
    if (source.kind === "file") {
      const preview = await call<ImportPreview>("preview_import", { path: source.path, invertAmounts, accountId, columnMap, columnHeaders });
      return { preview, folder: null };
    }
    const reply = await call<{ batch: FolderBatchReply; preview: ImportPreview }>("preview_folder_import", {
      batchId: source.batchId,
      invertAmounts,
      columnMap,
      columnHeaders,
    });
    return {
      preview: reply.preview,
      folder: { batchId: reply.batch.id, rowVersion: reply.batch.row_version, fileName: reply.batch.file_name, sourcePresent: reply.batch.source_present },
    };
  }

  /** Reads `path` and opens its review. `columns` says which look-ahead the column choice was made from, and
   * whether the account remembered it or the person just made it. Returns why it could not, or null. */
  async function openReview(
    source: ReviewSource,
    invertAmounts: boolean,
    accountId: number,
    columnMap: ColumnMap | null,
    columns: { inspection: ColumnInspection; source: ColumnMapSource } | null,
    /** For a folder export: the convention saved with its name (the review may differ after a flip). */
    nameInvert: boolean = invertAmounts,
  ): Promise<string | null> {
    try {
      const categories = await call<string[]>("list_categories");
      const { preview, folder } = await readPreview(source, invertAmounts, accountId, columnMap, columns);
      // duplicates and rows the bank still shows as pending default to excluded, everything
      // else defaults to included; the user can flip any row either way
      setIncludedIndices(initiallyIncluded(preview));
      // A row whose file said which account it belongs to (this app's own
      // Transactions CSV export does) pre-selects that account in its dropdown
      // when it matches one that already exists, rather than defaulting
      // every row to the account picked before the file was chosen — the
      // user still sees exactly what will happen and can change it.
      // Unmatched file names use the selected default account; imports never create accounts.
      setAccountOverrides(seedAccountOverrides(preview, accounts, accountId));
      setImportCategoryChoices(defaultCategoryChoices(preview.unmatched_categories, categories));
      setImportRowChoices(new Map());
      setNotice(null);
      const path = source.kind === "file" ? source.path : "";
      setPendingImport({
        path,
        invertAmounts,
        defaultAccountId: accountId,
        columnMap,
        columns: columnMap ? columns : null,
        preview,
        folder: folder ? { ...folder, nameInvert } : null,
      });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }

  async function begin(
    path: string,
    invertAmounts: boolean,
    accountId: number,
    columnMap: ColumnMap | null = null,
    columns: { inspection: ColumnInspection; source: ColumnMapSource } | null = null,
  ) {
    setBusy(true);
    setStatus("Reading file…", "info");
    const problem = await openReview({ kind: "file", path }, invertAmounts, accountId, columnMap, columns);
    setStatus(problem ?? "");
    setBusy(false);
  }

  /** Opens the review of a watched folder's saved export straight away, with its account and amount
   * convention from its export name in Settings. Returns why it could not, or null. */
  async function beginFolder(
    batchId: number,
    invertAmounts: boolean,
    accountId: number,
    columnMap: ColumnMap | null = null,
    columns: { inspection: ColumnInspection; source: ColumnMapSource } | null = null,
  ): Promise<string | null> {
    setBusy(true);
    setStatus("Reading export…", "info");
    setRememberSigns(false);
    const problem = await openReview({ kind: "folder", batchId }, invertAmounts, accountId, columnMap, columns);
    setStatus(problem ?? "", problem ? "error" : undefined);
    setBusy(false);
    return problem;
  }

  /** "Flip amount signs" on a folder export's review: reads it again the other way round. A new
   * interpretation is a new review, so the earlier approval can't be used for it. Imported rows are
   * never changed. */
  async function flipFolderSigns() {
    if (!pendingImport?.folder || busy) return;
    setBusy(true);
    try {
      const invertAmounts = !pendingImport.invertAmounts;
      const categories = await call<string[]>("list_categories");
      const { preview, folder } = await readPreview(
        sourceOf(pendingImport),
        invertAmounts,
        pendingImport.defaultAccountId,
        pendingImport.columnMap,
        pendingImport.columns,
      );
      // The same rows with their signs the other way: every answer already given still applies.
      const carried = carryOverReview(
        {
          preview: pendingImport.preview,
          defaultAccountId: pendingImport.defaultAccountId,
          included: includedIndices,
          panel: importCategoryChoices,
          rowChoices: importRowChoices,
          accountOverrides,
        },
        preview,
        categories,
        accounts,
        { sameRows: true },
      );
      setPendingImport({
        ...pendingImport,
        invertAmounts,
        preview,
        folder: folder ? { ...folder, nameInvert: pendingImport.folder.nameInvert } : pendingImport.folder,
      });
      setIncludedIndices(carried.included);
      setImportCategoryChoices(carried.panel);
      setImportRowChoices(carried.rowChoices);
      setAccountOverrides(carried.accountOverrides);
      setNotice(null);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** The look-ahead to show again when the person wants to change the columns in use (their picks as the starting point). */
  function columnsToChange(): ColumnInspection | null {
    if (!pendingImport?.columns || !pendingImport.columnMap) return null;
    return inspectionWithMap(pendingImport.columns.inspection, pendingImport.columnMap);
  }

  /** Reads the same file again with other columns. The account and the sign choice stay; the review starts
   * over for the new rows. If the new columns can't be read, the review stays as it was and says why. */
  async function changeColumns(columnMap: ColumnMap) {
    if (!pendingImport?.columns || busy) return;
    setBusy(true);
    const problem = await openReview(
      sourceOf(pendingImport),
      pendingImport.invertAmounts,
      pendingImport.defaultAccountId,
      columnMap,
      { inspection: pendingImport.columns.inspection, source: "chosen" },
      pendingImport.folder?.nameInvert,
    );
    if (problem) setNotice(problem);
    setBusy(false);
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
      // Picking the initial default is still explicit: the file may name a different account.
      next.set(index, accountId);
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
    const folder = pendingImport.folder ?? null;
    try {
      summary = await call<ImportSummary>(folder ? "commit_folder_import" : "commit_import", {
        ...(folder
          ? {
              batchId: folder.batchId,
              rowVersion: folder.rowVersion,
              // Only a choice that differs from the name's saved one can be remembered.
              rememberSigns: rememberSigns && pendingImport.invertAmounts !== folder.nameInvert,
            }
          : { path: pendingImport.path, defaultAccountId: pendingImport.defaultAccountId }),
        invertAmounts: pendingImport.invertAmounts,
        columnMap: pendingImport.columnMap,
        columnHeaders: pendingImport.columnMap && pendingImport.columns ? pendingImport.columns.inspection.headers : null,
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
        const { preview: next, folder: nextFolder } = await readPreview(
          sourceOf(pendingImport),
          pendingImport.invertAmounts,
          pendingImport.defaultAccountId,
          pendingImport.columnMap,
          pendingImport.columns,
        );
        const categories = await call<string[]>("list_categories");
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
        setPendingImport({
          ...pendingImport,
          preview: next,
          folder: nextFolder && pendingImport.folder ? { ...nextFolder, nameInvert: pendingImport.folder.nameInvert } : pendingImport.folder,
        });
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
    if (folder) onFolderChanged?.();
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

  /** Cancel, or for a folder export "Review later": nothing is imported and the export stays waiting. */
  function cancelPendingImport() {
    const folder = pendingImport?.folder;
    clearPendingImport();
    if (folder) {
      setStatus("Saved for later. The export is still waiting for review.", "info");
      onFolderChanged?.();
    } else {
      setStatus("Import cancelled.", "info");
    }
  }

  return {
    pendingImport,
    includedIndices,
    accountOverrides,
    importCategoryChoices,
    importRowChoices,
    setImportRowChoices,
    begin,
    beginFolder,
    flipFolderSigns,
    rememberSigns,
    setRememberSigns,
    columnsToChange,
    changeColumns,
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
