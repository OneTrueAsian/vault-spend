import type * as React from "react";

import { flipConfirmText } from "./importSigns";

import { CADENCE_OPTIONS } from "./cadence";

import type { FamilyMember, Transaction } from "./types";
import { MenuSelect } from "./MenuSelect";

interface LedgerBulkActionsProps {
  selectedIds: Set<number>;
  handleBulkCategoryChange: (value: string) => Promise<void>;
  categoryOptions: string[];
  handleAddSelectedToRecurring: (cadence: string) => Promise<void>;
  familyMembers: FamilyMember[];
  handleBulkMemberChange: (value: string) => Promise<void>;
  bulkTagText: string;
  setBulkTagText: React.Dispatch<React.SetStateAction<string>>;
  handleBulkAddTag: (tag: string) => Promise<void>;
  confirmingBulkDelete: boolean;
  setConfirmingBulkDelete: React.Dispatch<React.SetStateAction<boolean>>;
  handleBulkDelete: () => Promise<void>;
  confirmingBulkFlip: boolean;
  selectedAccountNames: string[];
  setConfirmingBulkFlip: React.Dispatch<React.SetStateAction<boolean>>;
  handleBulkFlipSigns: () => Promise<void>;
  selectedPairForLink: Transaction[] | null;
  handleLinkSelectedAsTransfer: () => Promise<void>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
}

export function LedgerBulkActions({
  selectedIds,
  handleBulkCategoryChange,
  categoryOptions,
  handleAddSelectedToRecurring,
  familyMembers,
  handleBulkMemberChange,
  bulkTagText,
  setBulkTagText,
  handleBulkAddTag,
  confirmingBulkDelete,
  setConfirmingBulkDelete,
  handleBulkDelete,
  confirmingBulkFlip,
  selectedAccountNames,
  setConfirmingBulkFlip,
  handleBulkFlipSigns,
  selectedPairForLink,
  handleLinkSelectedAsTransfer,
  setSelectedIds,
}: LedgerBulkActionsProps) {
  return (
    <div className="bulk-actions-bar">
      <span className="bulk-actions-count">{selectedIds.size} selected</span>
      <MenuSelect
        ariaLabel="Set category to…"
        placeholder="Set category to…"
        value={""}
        onChange={(v) => handleBulkCategoryChange(v)}
        options={[
          ...categoryOptions.map((c) => ({ value: c, label: c })),
          { value: "__new__", label: "+ New category…" },
        ]}
      />
      <MenuSelect
        ariaLabel="Add to Recurring…"
        placeholder="Add to Recurring…"
        value={""}
        onChange={(v) => handleAddSelectedToRecurring(v)}
        options={CADENCE_OPTIONS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))}
      />
      {familyMembers.length > 0 && (
        <MenuSelect
          ariaLabel="Set member to…"
          placeholder="Set member to…"
          value={""}
          onChange={(v) => handleBulkMemberChange(v)}
          options={[
            { value: "__none__", label: "Unassigned" },
            ...familyMembers.map((m) => ({ value: String(m.id), label: m.name })),
          ]}
        />
      )}
      <span className="bulk-tag-input">
        <input
          list="known-tags"
          placeholder="+ Add tag…"
          value={bulkTagText}
          onChange={(e) => setBulkTagText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleBulkAddTag(bulkTagText);
            }
          }}
        />
        <button type="button" className="modal-secondary" disabled={!bulkTagText.trim()} onClick={() => handleBulkAddTag(bulkTagText)}>
          Add tag
        </button>
      </span>
      {confirmingBulkDelete ? (
        <span className="row-delete-confirm">
          <button type="button" className="modal-secondary" onClick={() => setConfirmingBulkDelete(false)}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={handleBulkDelete}>
            Delete {selectedIds.size}
          </button>
        </span>
      ) : (
        <button type="button" className="modal-secondary" onClick={() => setConfirmingBulkDelete(true)}>
          Delete selected
        </button>
      )}
      {confirmingBulkFlip ? (
        <span className="row-delete-confirm" data-flip-signs-confirm>
          <span>{flipConfirmText(selectedIds.size, selectedAccountNames)}</span>
          <button type="button" className="modal-secondary" onClick={() => setConfirmingBulkFlip(false)}>
            Cancel
          </button>
          <button type="button" onClick={handleBulkFlipSigns}>
            Flip {selectedIds.size}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="modal-secondary"
          onClick={() => setConfirmingBulkFlip(true)}
          title="For rows imported the wrong way round: money out becomes money in and the other way round"
        >
          Flip signs…
        </button>
      )}
      {selectedPairForLink && (
        <button
          type="button"
          className="modal-secondary"
          onClick={handleLinkSelectedAsTransfer}
          title="These two look like the two sides of one move between your own accounts"
        >
          Link as transfer
        </button>
      )}
      <button type="button" className="modal-secondary" onClick={() => setSelectedIds(new Set())}>
        Clear selection
      </button>
    </div>
  );
}
