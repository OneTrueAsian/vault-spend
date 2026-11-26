import type * as React from "react";
import type { ImportReview } from "../imports/useImportReview";

interface TransactionsPageActionsProps {
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
  handleExportTransactionsCsv: () => Promise<void>;
  /** Opens the read-only history of moves between accounts (from the More actions menu). */
  openAccountMoveHistory: () => void;
  /** Folder activity (VS-102), shown once folder imports are set up: opens the activity dialog. */
  folderActivity?: { pendingCount: number; onOpen: () => void } | null;
}

/** The Transactions page's own buttons, beside its title: Import, Folder activity (once folder imports are set up), Add, Manage categories, and the ⋯ menu. Import and Add each ask
 * which account they are for, so nothing here stands for an account. */
export function TransactionsPageActions({
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
  handleExportTransactionsCsv,
  openAccountMoveHistory,
  folderActivity = null,
}: TransactionsPageActionsProps) {
  return (
    <div className="import-controls">
      <button onClick={handleImport} disabled={busy || importReview.pendingImport !== null || !dataLoaded}>
        {busy ? "Importing…" : "Import transactions"}
      </button>
      {folderActivity && (
        <button
          type="button"
          className="modal-secondary"
          onClick={folderActivity.onOpen}
          disabled={busy || importReview.pendingImport !== null || !dataLoaded}
          data-folder-activity-open
        >
          {folderActivity.pendingCount > 0 ? `Folder activity (${folderActivity.pendingCount})` : "Folder activity"}
        </button>
      )}
      <button
        className="modal-secondary"
        onClick={() => setNewTransactionOpen(true)}
        disabled={busy || importReview.pendingImport !== null || !dataLoaded}
      >
        Add transaction
      </button>
      <button
        className="modal-secondary"
        onClick={openManageCategories}
        disabled={busy || importReview.pendingImport !== null || !dataLoaded}
      >
        Manage categories
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
                openManageFamilyMembers();
              }}
            >
              Manage family members
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
                handleExportTransactionsCsv();
              }}
            >
              Export CSV
            </button>
            <div className="more-menu-divider"></div>
            <button
              type="button"
              className="more-menu-item"
              onClick={() => {
                setMoreMenuOpen(false);
                openAccountMoveHistory();
              }}
              data-account-move-history
            >
              Account move history
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
