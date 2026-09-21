import { FormEvent, useState } from "react";
import type { Asset, FamilyMember } from "./types";
import { formatAmount, isValidDecimalString, toLocalIsoDate } from "./format";
import { useAutoCancelDelete } from "./useAutoCancelDelete";

const ASSET_TYPE_OPTIONS = ["real_estate", "vehicle", "other"];
const ASSET_TYPE_LABELS: Record<string, string> = {
  real_estate: "Real Estate",
  vehicle: "Vehicle",
  other: "Other",
};

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
      <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
        {ASSET_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {ASSET_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Current value"
        aria-invalid={submitAttempted && valueError !== null}
      />
      {submitAttempted && valueError && <span className="field-error">{valueError}</span>}
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      {familyMembers.length > 0 && (
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Unassigned</option>
          {familyMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
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

  const total = assets.reduce((s, a) => s + parseFloat(a.value), 0);

  function commitEdit(id: number, value: string) {
    setEditing(null);
    if (!value.trim()) return;
    onUpdateValue(id, value.trim(), toLocalIsoDate());
  }

  return (
    <div data-property-assets>
      <h2 className="reports-section-title">
        Property &amp; Valuables <span className="account-col">{formatAmount(total)}</span>
      </h2>
      <div className="table-scroll">
      <table className="ledger">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="amount-col">Value</th>
            <th>Member</th>
            <th>Updated</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>
                <div className="account-name-cell">{a.name}</div>
                {a.notes && <span className="account-col">{a.notes}</span>}
              </td>
              <td>{ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}</td>
              <td className="amount-col">
                {editing?.id === a.id ? (
                  <input
                    autoFocus
                    className="amount-edit-input"
                    value={editing.value}
                    onChange={(e) => setEditing({ id: a.id, value: e.target.value })}
                    onBlur={() => commitEdit(a.id, editing.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(a.id, editing.value);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <span
                    className="amount-editable"
                    title="Click to update the value"
                    onClick={() => setEditing({ id: a.id, value: a.value })}
                  >
                    {formatAmount(a.value)}
                  </span>
                )}
              </td>
              <td className="member-col">
                <select
                  value={a.member_id ?? ""}
                  onChange={(e) => onSetMember(a.id, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {familyMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>{a.valued_on}</td>
              <td className="actions-col">
                {confirmingDeleteId === a.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn-danger" onClick={() => onDelete(a.id)}>
                      Delete
                    </button>
                  </span>
                ) : (
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(a.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
          {assets.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-state">
                No property or valuables tracked yet.
              </td>
            </tr>
          )}
          <tr>
            <td colSpan={6}>
              <NewAssetForm familyMembers={familyMembers} onCreate={onCreate} />
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}
