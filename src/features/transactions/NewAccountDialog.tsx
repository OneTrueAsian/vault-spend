import { type FamilyMember } from "../../shared/lib/types";
import { useState, FormEvent } from "react";
import { type AccountIconKey, IconPicker, ACCOUNT_ICON_OPTIONS, AccountTypeIcon } from "../../shared/ui/icons";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { ModalShell } from "../../shared/ui/Modal";

export const ACCOUNT_TYPE_OPTIONS = ["checking", "savings", "credit", "loan", "investment", "other"];

export function NewAccountDialog({
  familyMembers,
  existingAccountNames = [],
  onCancel,
  onSubmit,
}: {
  familyMembers: FamilyMember[];
  /** Names already in use; a match (ignoring case and spaces) is refused here and by the backend. */
  existingAccountNames?: string[];
  onCancel: () => void;
  onSubmit: (
    name: string,
    accountType: string,
    startingBalance: string | null,
    institution: string | null,
    mask: string | null,
    memberId: number | null,
    iconKey: string | null,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("checking");
  const [startingBalance, setStartingBalance] = useState("");
  const [institution, setInstitution] = useState("");
  const [mask, setMask] = useState("");
  const [memberId, setMemberId] = useState("");
  const [iconKey, setIconKey] = useState<AccountIconKey | null>(null);
  const takenName = existingAccountNames.find((n) => n.trim().toLowerCase() === name.trim().toLowerCase());

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || takenName) return;
    onSubmit(
      name.trim(),
      accountType,
      startingBalance.trim() ? startingBalance.trim() : null,
      institution.trim() ? institution.trim() : null,
      mask.trim() ? mask.trim() : null,
      memberId ? Number(memberId) : null,
      iconKey,
    );
  }

  const balanceLabel =
    accountType === "credit" ? "Credit limit" : accountType === "loan" ? "Amount currently owed" : "Starting balance";

  return (
    <ModalShell title="New account" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Account name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Everyday Checking"'
            aria-invalid={takenName !== undefined}
            aria-describedby={takenName ? "new-account-name-error" : undefined}
          />
          {takenName && (
            <span className="field-error" id="new-account-name-error">
              You already have an account called "{takenName}". Choose a different name.
            </span>
          )}
        </label>
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
        <label className="modal-field">
          <span>Icon (optional)</span>
          <IconPicker
            options={ACCOUNT_ICON_OPTIONS}
            value={iconKey}
            onChange={setIconKey}
            renderIcon={(key) => <AccountTypeIcon accountType={accountType} iconKey={key} />}
          />
        </label>
        <label className="modal-field">
          <span>{balanceLabel} (optional)</span>
          <input
            value={startingBalance}
            onChange={(e) => setStartingBalance(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="modal-field">
          <span>Institution (optional)</span>
          <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Chase" />
        </label>
        <label className="modal-field">
          <span>Last 4 digits (optional)</span>
          <input value={mask} onChange={(e) => setMask(e.target.value)} placeholder="4821" maxLength={4} />
        </label>
        {familyMembers.length > 0 && (
          <label className="modal-field">
            <span>Family member (optional)</span>
            <MenuSelect
              ariaLabel="Family member (optional)"
              value={memberId}
              onChange={setMemberId}
              options={[
                { value: "", label: "Unassigned" },
                ...familyMembers.map((m) => ({ value: String(m.id), label: m.name })),
              ]}
              fill
            />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim() || takenName !== undefined}>
            Create account
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
