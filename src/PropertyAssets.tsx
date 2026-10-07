import { FormEvent, useState } from "react";
import type { Asset, FamilyMember } from "./types";
import { formatAmount, formatFullDate, isValidDecimalString, toLocalIsoDate } from "./format";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { MenuSelect } from "./MenuSelect";
import { RowMenu } from "./RowMenu";
import { AccountTypeIcon } from "./icons";
import { sumMoney } from "./money";
import { storedTypeLabel } from "./accountGroups";

const ASSET_TYPE_OPTIONS = ["real_estate", "vehicle", "other"];
const ASSET_TYPE_LABELS: Record<string, string> = {
  real_estate: "Real Estate",
  vehicle: "Vehicle",
  other: "Other",
};

/** A type's label; a type this list doesn't know (from older data or a setup file) is named the way an
 * account type is. */
export function assetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS[type] ?? storedTypeLabel(type);
}

function NewAssetForm({
  familyMembers,
  onCreate,
}: {
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState(ASSET_TYPE_OPTIONS[0]);
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [memberId, setMemberId] = useState("");
  const [open, setOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const valueTrimmed = value.trim();
  const valueError =
    valueTrimmed === ""
      ? "Enter a value."
      : !isValidDecimalString(valueTrimmed)
        ? "That doesn't look like a number."
        : parseFloat(valueTrimmed) < 0
          ? "Value can't be negative."
          : null;
  const valid = name.trim() !== "" && !valueError;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!valid) return;
    onCreate(name.trim(), assetType, valueTrimmed, toLocalIsoDate(), notes.trim() || null, memberId ? Number(memberId) : null);
    setName("");
    setValue("");
    setNotes("");
    setMemberId("");
    setSubmitAttempted(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}>Add property or valuable…</button>
    );
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Home"' />
      <MenuSelect
        ariaLabel="Asset type"
        value={assetType}
        onChange={setAssetType}
        options={ASSET_TYPE_OPTIONS.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }))}
        fill
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Current value"
        aria-invalid={submitAttempted && valueError !== null}
      />
      {submitAttempted && valueError && <span className="field-error">{valueError}</span>}
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      {familyMembers.length > 0 && (
        <MenuSelect
          ariaLabel="Family member"
          value={memberId}
          onChange={setMemberId}
          options={[
            { value: "", label: "Unassigned" },
            ...familyMembers.map((m) => ({ value: String(m.id), label: m.name })),
          ]}
          fill
        />
      )}
      <button type="submit" disabled={!name.trim()}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

/** A thing you own's icon: a house for property, a car for a vehicle, the plain "other" glyph otherwise. */
function AssetIcon({ assetType }: { assetType: string }) {
  if (assetType === "real_estate") return <AccountTypeIcon accountType="loan" />;
  if (assetType === "vehicle") return <AccountTypeIcon accountType="other" iconKey="car" />;
  return <AccountTypeIcon accountType="other" />;
}

/** Property and valuables on the Accounts page: one group card like the account groups above it (UI
 * mockup, UAT s7.1), a row per thing with its value on the right. Click the value to update it; the
 * row's ⋯ menu updates the value, says who it belongs to, or deletes it (asking first). */
export function PropertyAssetsSection({
  assets,
  familyMembers,
  onCreate,
  onUpdateValue,
  onSetMember,
  onDelete,
}: {
  assets: Asset[];
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
  onUpdateValue: (id: number, value: string, valuedOn: string) => void;
  onSetMember: (id: number, memberId: number | null) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));

  const total = sumMoney(assets.map((a) => a.value));
  const sorted = [...assets].sort((a, b) => parseFloat(b.value) - parseFloat(a.value) || a.name.localeCompare(b.name));

  function commitEdit(id: number, value: string) {
    setEditing(null);
    if (!value.trim()) return;
    onUpdateValue(id, value.trim(), toLocalIsoDate());
  }

  return (
    <section className="account-group" data-property-assets>
      <div className="account-group-head">
        <h2>Property and valuables</h2>
        <span className="account-group-total">{formatAmount(total)}</span>
      </div>
      <div className="account-cards">
        {sorted.map((a) => {
          const detail = [assetTypeLabel(a.asset_type), `updated ${formatFullDate(a.valued_on)}`, a.member_name, a.notes].filter(Boolean).join(" \u00b7 ");
          return (
            <div key={a.id} className="account-card" data-asset-id={a.id}>
              <span className="type-badge" aria-hidden="true">
                <AssetIcon assetType={a.asset_type} />
              </span>
              <div className="info">
                <div className="account-name-cell">{a.name}</div>
                <span className="sub account-name-detail-static">{detail}</span>
              </div>
              <div className="account-card-end">
                {confirmingDeleteId === a.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn-danger" onClick={() => onDelete(a.id)}>
                      Delete
                    </button>
                  </span>
                ) : editing?.id === a.id ? (
                  <input
                    autoFocus
                    className="amount-edit-input"
                    aria-label={`Value of ${a.name}`}
                    value={editing.value}
                    onChange={(e) => setEditing({ id: a.id, value: e.target.value })}
                    onBlur={() => commitEdit(a.id, editing.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(a.id, editing.value);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="bal amount-editable"
                    title="Click to update the value"
                    onClick={() => setEditing({ id: a.id, value: a.value })}
                  >
                    {formatAmount(a.value)}
                  </button>
                )}
              </div>
              <RowMenu
                label={`Actions for ${a.name}`}
                items={[
                  { label: "Update value…", onSelect: () => setEditing({ id: a.id, value: a.value }) },
                  ...familyMembers.map((m) => ({
                    kind: "check" as const,
                    label: `Belongs to ${m.name}`,
                    checked: a.member_id === m.id,
                    onToggle: (next: boolean) => onSetMember(a.id, next ? m.id : null),
                  })),
                  { label: "Delete…", onSelect: () => setConfirmingDeleteId(a.id), danger: true },
                ]}
              />
            </div>
          );
        })}
        {assets.length === 0 && <p className="account-group-empty">No property or valuables added yet.</p>}
        <div className="account-group-add">
          <NewAssetForm familyMembers={familyMembers} onCreate={onCreate} />
        </div>
      </div>
    </section>
  );
}
