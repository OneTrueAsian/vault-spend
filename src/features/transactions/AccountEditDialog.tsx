import { type Account, type FamilyMember } from "../../shared/lib/types";
import { useState, FormEvent } from "react";
import { useAutoCancelDelete } from "../../shared/hooks/useAutoCancelDelete";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { ModalShell } from "../../shared/ui/Modal";
import { ACCOUNT_TYPE_OPTIONS } from "./NewAccountDialog";

/** The Accounts page's "Edit" — everything about an account that isn't its
 * balance, in one place: type, which family member it belongs to, institution
 * and last four digits, and (behind an explicit second step) deleting it.
 * These used to be a permanently visible pair of dropdowns and a Delete
 * button on every account card. Nothing is saved until "Save changes", and
 * only what actually changed is sent. */
export function AccountEditDialog({
  account,
  familyMembers,
  onSave,
  onDelete,
  onCancel,
  startWithDeleteConfirm = false,
}: {
  account: Account;
  familyMembers: FamilyMember[];
  onSave: (changes: { accountType?: string; memberId?: number | null; institution?: string | null; mask?: string | null }) => void;
  onDelete: () => void;
  onCancel: () => void;
  /** Opened from a row's Delete: already asking whether to delete. */
  startWithDeleteConfirm?: boolean;
}) {
  const [accountType, setAccountType] = useState(account.account_type);
  const [memberId, setMemberId] = useState<number | null>(account.member_id);
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [mask, setMask] = useState(account.mask ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(startWithDeleteConfirm);
  useAutoCancelDelete(confirmingDelete ? "delete" : null, () => setConfirmingDelete(false));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const changes: Parameters<typeof onSave>[0] = {};
    if (accountType !== account.account_type) changes.accountType = accountType;
    if (memberId !== account.member_id) changes.memberId = memberId;
    const nextInstitution = institution.trim() || null;
    const nextMask = mask.trim() || null;
    if (nextInstitution !== (account.institution ?? null) || nextMask !== (account.mask ?? null)) {
      changes.institution = nextInstitution;
      changes.mask = nextMask;
    }
    onSave(changes);
  }

  return (
    <ModalShell title={`Edit ${account.name}`} onCancel={onCancel} wide>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Account type</span>
          <MenuSelect
            ariaLabel="Account type"
            value={accountType}
            onChange={setAccountType}
            options={ACCOUNT_TYPE_OPTIONS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
            fill
          />
        </label>
        {familyMembers.length > 0 && (
          <label className="modal-field">
            <span>Family member</span>
            <MenuSelect
              ariaLabel="Family member"
              value={memberId == null ? "" : String(memberId)}
              onChange={(v) => setMemberId(v ? Number(v) : null)}
              options={[
                { value: "", label: "Unassigned" },
                ...familyMembers.map((m) => ({ value: String(m.id), label: m.name })),
              ]}
              fill
            />
          </label>
        )}
        <label className="modal-field">
          <span>Institution (optional)</span>
          <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder='e.g. "Chase"' />
        </label>
        <label className="modal-field">
          <span>Last 4 digits (optional)</span>
          <input value={mask} maxLength={4} onChange={(e) => setMask(e.target.value)} placeholder="1234" />
        </label>
        <div className="modal-actions modal-actions-split">
          {confirmingDelete ? (
            <span className="row-delete-confirm">
              <span className="modal-message-secondary">Delete this account and its transactions?</span>
              <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
              <button type="button" className="btn-danger" onClick={onDelete}>
                Delete account
              </button>
            </span>
          ) : (
            <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(true)}>
              Delete account
            </button>
          )}
          <span className="modal-actions-end">
            <button type="button" className="modal-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Save changes</button>
          </span>
        </div>
      </form>
    </ModalShell>
  );
}
