import type { Dispatch, SetStateAction } from "react";
import type { TransactionSnapshot } from "../../shared/native/transactionContracts";
import { open, save } from "../../shared/native/nativeDialog";
import { type StatusKind } from "../../shared/native/appTypes";
import { type SetupImportPreview, type SetupImportSummary } from "../../shared/lib/types";
import { buildSetupTemplate } from "./setupTemplate";
import { errorMessage } from "../../shared/lib/errorMessage";
import { emptySetupMessage, setupImportMessage } from "./setupImportMessage";

export function useSetupImportActions({ invoke, setStatus, setPendingSetupImport, pendingSetupImport, setBusy, refresh, refreshBuckets, refreshHoldings }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  setStatus: (text: string, kind?: StatusKind) => void;
  setPendingSetupImport: Dispatch<SetStateAction<{ path: string; preview: SetupImportPreview; includedAccounts: Set<number>; includedCategories: Set<number>; includedBudgets: Set<number>; includedBuckets: Set<number>; includedHoldings: Set<number>; } | null>>;
  pendingSetupImport: { path: string; preview: SetupImportPreview; includedAccounts: Set<number>; includedCategories: Set<number>; includedBudgets: Set<number>; includedBuckets: Set<number>; includedHoldings: Set<number>; } | null;
  setBusy: Dispatch<SetStateAction<boolean>>;
  refresh: () => Promise<TransactionSnapshot>;
  refreshBuckets: () => Promise<void>;
  refreshHoldings: () => Promise<void>;
}) {
  async function handleDownloadSetupTemplate() {
    const path = await save({
      defaultPath: "vaultspend-setup-template.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      await invoke("write_text_file", { path, content: buildSetupTemplate() });
      setStatus(`Setup template saved to ${path} — fill it in, then use "Import setup data".`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleImportSetupData() {
    const path = await open({ multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const preview = await invoke<SetupImportPreview>("preview_setup_import", { path });
      const total =
        preview.accounts.length +
        preview.categories.length +
        preview.budgets.length +
        preview.buckets.length +
        preview.holdings.length;
      if (total === 0) {
        setStatus(
          emptySetupMessage(preview.row_errors),
          preview.row_errors > 0 ? "error" : "info",
        );
        return;
      }
      // Duplicates start unchecked, same convention as the transaction
      // import's review screen; budget "will update" rows stay checked
      // since updating an existing budget line is usually the intent.
      // Holdings with an unresolved account start unchecked too — checking
      // one would just get silently skipped at commit time anyway.
      setPendingSetupImport({
        path,
        preview,
        includedAccounts: new Set(preview.accounts.filter((r) => !r.already_exists).map((r) => r.index)),
        includedCategories: new Set(preview.categories.filter((r) => !r.already_exists).map((r) => r.index)),
        includedBudgets: new Set(preview.budgets.map((r) => r.index)),
        includedBuckets: new Set(preview.buckets.filter((r) => !r.already_exists).map((r) => r.index)),
        includedHoldings: new Set(preview.holdings.filter((r) => r.account_found).map((r) => r.index)),
      });
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  function toggleSetupIncluded(
    section: "includedAccounts" | "includedCategories" | "includedBudgets" | "includedBuckets" | "includedHoldings",
    index: number,
  ) {
    setPendingSetupImport((prev) => {
      if (!prev) return prev;
      const next = new Set(prev[section]);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...prev, [section]: next };
    });
  }

  async function confirmSetupImport() {
    if (!pendingSetupImport) return;
    setBusy(true);
    try {
      const summary = await invoke<SetupImportSummary>("commit_setup_import", {
        path: pendingSetupImport.path,
        includedAccounts: Array.from(pendingSetupImport.includedAccounts),
        includedCategories: Array.from(pendingSetupImport.includedCategories),
        includedBudgets: Array.from(pendingSetupImport.includedBudgets),
        includedBuckets: Array.from(pendingSetupImport.includedBuckets),
        includedHoldings: Array.from(pendingSetupImport.includedHoldings),
      });
      setPendingSetupImport(null);
      await Promise.all([refresh(), refreshBuckets(), refreshHoldings()]);
      const message = setupImportMessage(summary);
      setStatus(message, summary.row_errors > 0 ? "error" : "success");
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return { handleDownloadSetupTemplate, handleImportSetupData, toggleSetupIncluded, confirmSetupImport };
}
