import "./Ledger.css";
import type * as React from "react";

import type { Transaction } from "./types";

interface LedgerSavedFiltersProps {
  savedFilters: import("./appTypes").SavedLedgerFilter[];
  applySavedFilter: (filter: import("./appTypes").SavedLedgerFilter) => void;
  deleteSavedFilter: (name: string) => void;
  savingFilter: boolean;
  saveCurrentFilter: () => void;
  newFilterName: string;
  setNewFilterName: React.Dispatch<React.SetStateAction<string>>;
  setSavingFilter: React.Dispatch<React.SetStateAction<boolean>>;
  transferCandidatePairs: { out: Transaction; in: Transaction; }[];
  setTransferReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  autoLinkedPairs: { out: Transaction; in: Transaction; }[];
  setAutoLinkReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function LedgerSavedFilters({
  savedFilters,
  applySavedFilter,
  deleteSavedFilter,
  savingFilter,
  saveCurrentFilter,
  newFilterName,
  setNewFilterName,
  setSavingFilter,
  transferCandidatePairs,
  setTransferReviewOpen,
  autoLinkedPairs,
  setAutoLinkReviewOpen,
}: LedgerSavedFiltersProps) {
  return (
    <div className="saved-filter-bar">
      {savedFilters.map((f) => (
        <span key={f.name} className="saved-filter-chip">
          <button type="button" onClick={() => applySavedFilter(f)} title={`Apply saved filter "${f.name}"`}>
            {f.name}
          </button>
          <button
            type="button"
            className="saved-filter-chip-remove"
            onClick={() => deleteSavedFilter(f.name)}
            aria-label={`Remove saved filter ${f.name}`}
          >
            ×
          </button>
        </span>
      ))}
      {savingFilter ? (
        <form
          className="saved-filter-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveCurrentFilter();
          }}
        >
          <input
            autoFocus
            value={newFilterName}
            onChange={(e) => setNewFilterName(e.target.value)}
            placeholder='e.g. "Uncategorized this month"'
          />
          <button type="submit" className="btn-sm" disabled={!newFilterName.trim()}>
            Save
          </button>
          <button
            type="button"
            className="modal-secondary btn-sm"
            onClick={() => {
              setSavingFilter(false);
              setNewFilterName("");
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="modal-secondary btn-sm" onClick={() => setSavingFilter(true)}>
          + Save current filter…
        </button>
      )}
      {transferCandidatePairs.length > 0 && (
        <button type="button" className="modal-secondary btn-sm transfer-suggestion" onClick={() => setTransferReviewOpen(true)}>
          ⇄ {transferCandidatePairs.length} possible transfer{transferCandidatePairs.length === 1 ? "" : "s"} — review
        </button>
      )}
      {autoLinkedPairs.length > 0 && (
        <button
          type="button"
          className="modal-secondary btn-sm transfer-suggestion"
          data-autolink-review
          onClick={() => setAutoLinkReviewOpen(true)}
        >
          ⇄ {autoLinkedPairs.length} auto-linked — review
        </button>
      )}
      {/* Hidden by request; keep the original selector available to restore.
      <div className="density-toggle" role="group" aria-label="Row density">
        {(["comfortable", "compact"] as LedgerDensity[]).map((d) => (
          <button
            key={d}
            type="button"
            className={ledgerDensity === d ? "density-toggle-active" : ""}
            aria-pressed={ledgerDensity === d}
            onClick={() => setLedgerDensity(d)}
          >
            {d === "comfortable" ? "Comfortable" : "Compact"}
          </button>
        ))}
      </div>
      */}
    </div>
  );
}
