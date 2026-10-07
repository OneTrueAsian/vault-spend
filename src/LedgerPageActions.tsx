import type * as React from "react";
import type { ImportReview } from "./useImportReview";
import { AccountDestinationDropdown } from "./AccountDestinationDropdown";
import type { Account } from "./types";

interface LedgerPageActionsProps {
  accounts: Account[];
  selectedAccountId: number | null;
  handleAccountSelectChange: (value: string) => void;
  busy: boolean;
  importReview: ImportReview;
  dataLoaded: boolean;
  handleImport: () => Promise<void>;
  setNewTransactionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  moreMenuRef: React.RefObject<HTMLDivElement | null>;
  setMoreMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  moreMenuOpen: boolean;
  moreMenuShouldRender: boolean;
  moreMenuClosing: boolean;
  openManageCategories: () => void;
  openManageFamilyMembers: () => void;
  handleRecategorize: () => Promise<void>;
  handleExportLedgerCsv: () => Promise<void>;
}

/** The Transactions page's own buttons, beside its title: "Add to", Import, Add, and the ⋯ menu. */
export function LedgerPageActions({
  accounts,
  selectedAccountId,
  handleAccountSelectChange,
  busy,
  importReview,
  dataLoaded,
  handleImport,
  setNewTransactionOpen,
  moreMenuRef,
  setMoreMenuOpen,
  moreMenuOpen,
  moreMenuShouldRender,
  moreMenuClosing,
  openManageCategories,
  openManageFamilyMembers,
  handleRecategorize,
  handleExportLedgerCsv,
}: LedgerPageActionsProps) {
  return (
    <div className="import-controls">
      <label
        className="import-controls-label"
        htmlFor="ledger-account-select"
        title="The account that Import transactions… and Add transaction… start on"
      >
        Add to
      </label>
      <AccountDestinationDropdown
        accounts={accounts}
        value={selectedAccountId}
        onChange={handleAccountSelectChange}
        disabled={busy || importReview.pendingImport !== null || !dataLoaded}
        emptyLabel={dataLoaded ? undefined : "Loading…"}
      />
      <button onClick={handleImport} disabled={busy || importReview.pendingImport !== null || !dataLoaded}>
        {busy ? "Importing…" : "Import transactions…"}
      </button>
      <button
        className="modal-secondary"
        onClick={() => setNewTransactionOpen(true)}
        disabled={busy || importReview.pendingImport !== null || !dataLoaded}
      >
        Add transaction…
      </button>
      <div className="more-menu" ref={moreMenuRef}>
        <button
          type="button"
          className="modal-secondary btn-icon"
          onClick={() => setMoreMenuOpen((v) => !v)}
          disabled={busy || importReview.pendingImport !== null || !dataLoaded}
          aria-label="More actions"
          title="More actions"
          aria-haspopup="true"
          aria-expanded={moreMenuOpen}
        >
          ⋯
        </button>
        {moreMenuShouldRender && (
          <div className={moreMenuClosing ? "more-menu-panel more-menu-panel-closing" : "more-menu-panel"}>
            <button
              type="button"
              className="more-menu-item"
              onClick={() => {
                setMoreMenuOpen(false);
                openManageCategories();
              }}
            >
              Manage categories…
            </button>
            <button
              type="button"
              className="more-menu-item"
              onClick={() => {
                setMoreMenuOpen(false);
                openManageFamilyMembers();
              }}
            >
              Manage family members…
            </button>
            <div className="more-menu-divider"></div>
            <button
              type="button"
              className="more-menu-item"
              onClick={() => {
                setMoreMenuOpen(false);
                handleRecategorize();
              }}
              title="Re-run categorization on every Uncategorized transaction using what's been learned so far"
            >
              Categorize uncategorized
            </button>
            <div className="more-menu-divider"></div>
            <button
              type="button"
              className="more-menu-item"
              onClick={() => {
                setMoreMenuOpen(false);
                handleExportLedgerCsv();
              }}
            >
              Export CSV…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
