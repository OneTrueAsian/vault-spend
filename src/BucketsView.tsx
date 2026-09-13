import { FormEvent, useState } from "react";
import type { Account, Bucket, FamilyMember } from "./types";
import { formatAmount, toLocalIsoDate } from "./format";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { BUCKET_ICON_OPTIONS, BucketIcon, isBucketIconKey, type BucketIconKey } from "./icons";

const BUCKET_COLORS = ["#1E9E76", "#3E7CB8", "#C08A2E", "#8A5FB0", "#BD5B3C", "#4E8FC9", "#B0526A", "#5FA85E"];

function ColorPicker({ value, onChange }: { value: string | null; onChange: (color: string | null) => void }) {
  return (
    <div className="bucket-color-picker" role="group" aria-label="Card color">
      <button
        type="button"
        className={value === null ? "bucket-color-swatch bucket-color-swatch-none bucket-color-swatch-active" : "bucket-color-swatch bucket-color-swatch-none"}
        title="No color"
        onClick={() => onChange(null)}
      />
      {BUCKET_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          className={value === c ? "bucket-color-swatch bucket-color-swatch-active" : "bucket-color-swatch"}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

/** Lets a user override the name-guessed icon (`icons/bucketIcons.tsx`) with an
 * explicit choice — `null` means "keep guessing from the name," same
 * no-explicit-color convention `ColorPicker` above already uses. */
function IconPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: BucketIconKey | null;
  onChange: (key: BucketIconKey | null) => void;
}) {
  return (
    <div className="icon-picker" role="group" aria-label="Icon">
      {BUCKET_ICON_OPTIONS.map((opt) => (
        <button
          type="button"
          key={opt.key}
          className={value === opt.key ? "icon-picker-swatch icon-picker-swatch-active" : "icon-picker-swatch"}
          title={opt.key}
          aria-label={`Use the ${opt.key} icon`}
          onClick={() => onChange(opt.key)}
        >
          <BucketIcon name={name} iconKey={opt.key} />
        </button>
      ))}
    </div>
  );
}

export function daysLeft(targetDate: string): number {
  const target = new Date(targetDate + "T00:00:00");
  const today = new Date(toLocalIsoDate() + "T00:00:00");
  return Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000));
}

function NewBucketForm({
  accounts,
  familyMembers,
  onCreate,
}: {
  accounts: Account[];
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sinkingAmount, setSinkingAmount] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [iconKey, setIconKey] = useState<BucketIconKey | null>(null);
  const [open, setOpen] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(
      name.trim(),
      target.trim() ? target.trim() : null,
      targetDate.trim() ? targetDate.trim() : null,
      accountId ? Number(accountId) : null,
      memberId ? Number(memberId) : null,
      sinkingAmount.trim() ? sinkingAmount.trim() : null,
      color,
      iconKey,
    );
    setName("");
    setTarget("");
    setTargetDate("");
    setAccountId("");
    setMemberId("");
    setSinkingAmount("");
    setColor(null);
    setIconKey(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="add-tile" onClick={() => setOpen(true)}>
        <span className="add-tile-plus" aria-hidden="true">+</span>
        New goal…
      </button>
    );
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Emergency Fund"' />
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target amount (optional)" />
      <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} title="Target date" />
      <select aria-label="Linked account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">No linked account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {familyMembers.length > 0 && (
        <select aria-label="Family member" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Unassigned</option>
          {familyMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      <input
        value={sinkingAmount}
        onChange={(e) => setSinkingAmount(e.target.value)}
        placeholder="Auto-contribute monthly (optional)"
        title="Automatically add this amount once a month, for an irregular annual cost like insurance or gifts"
      />
      <IconPicker name={name} value={iconKey} onChange={setIconKey} />
      <ColorPicker value={color} onChange={setColor} />
      <div className="bucket-new-form-actions">
        <button type="submit" disabled={!name.trim()}>
          Create
        </button>
        <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditBucketForm({
  bucket,
  accounts,
  onSave,
  onCancel,
}: {
  bucket: Bucket;
  accounts: Account[];
  onSave: (
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
  ) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(bucket.target_amount ?? "");
  const [targetDate, setTargetDate] = useState(bucket.target_date ?? "");
  const [accountId, setAccountId] = useState(bucket.account_id !== null ? String(bucket.account_id) : "");
  const [sinkingAmount, setSinkingAmount] = useState(bucket.sinking_amount ?? "");
  const [color, setColor] = useState<string | null>(bucket.color);
  const [iconKey, setIconKey] = useState<BucketIconKey | null>(
    bucket.icon_key && isBucketIconKey(bucket.icon_key) ? bucket.icon_key : null,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave(
      target.trim() ? target.trim() : null,
      targetDate.trim() ? targetDate.trim() : null,
      accountId ? Number(accountId) : null,
      sinkingAmount.trim() ? sinkingAmount.trim() : null,
      color,
      iconKey,
    );
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input
        autoFocus
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder="Target amount (optional)"
      />
      <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} title="Target date" />
      <select aria-label="Linked account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">No linked account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input
        value={sinkingAmount}
        onChange={(e) => setSinkingAmount(e.target.value)}
        placeholder="Auto-contribute monthly (optional)"
        title="Automatically add this amount once a month, for an irregular annual cost like insurance or gifts"
      />
      <IconPicker name={bucket.name} value={iconKey} onChange={setIconKey} />
      <ColorPicker value={color} onChange={setColor} />
      <div className="bucket-new-form-actions">
        <button type="submit">Save</button>
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ContributionForm({
  bucketId,
  onAddContribution,
}: {
  bucketId: number;
  onAddContribution: (bucketId: number, date: string, amount: string, note: string | null) => void;
}) {
  const today = toLocalIsoDate();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount.trim()) return;
    onAddContribution(bucketId, today, amount.trim(), note.trim() ? note.trim() : null);
    setAmount("");
    setNote("");
  }

  return (
    <form className="bucket-contribution-form" onSubmit={handleSubmit}>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount (negative = withdrawal)"
      />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
      <button type="submit" disabled={!amount.trim()}>
        Add
      </button>
    </form>
  );
}

export function BucketsView({
  buckets,
  accounts,
  familyMembers,
  onCreateBucket,
  onUpdateBucketDetails,
  onAddContribution,
  onDeleteBucket,
}: {
  buckets: Bucket[];
  accounts: Account[];
  familyMembers: FamilyMember[];
  onCreateBucket: (
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
  ) => void;
  onUpdateBucketDetails: (
    id: number,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
  ) => void;
  onAddContribution: (bucketId: number, date: string, amount: string, note: string | null) => void;
  onDeleteBucket: (id: number) => void;
}) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div className="buckets-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Goals</h1>
          <p className="view-sub">Savings goals and sinking funds.</p>
        </div>
      </div>
      {buckets.length === 0 && (
        <p className="empty-state">No savings goals yet — create one to start tracking a goal.</p>
      )}
      <div className="buckets-grid">
        {buckets.map((b) => {
          const saved = parseFloat(b.saved_amount);
          const target = b.target_amount ? parseFloat(b.target_amount) : null;
          const pct = target && target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : null;
          return (
            <div key={b.id} className="bucket-card" style={b.color ? { borderTop: `3px solid ${b.color}` } : undefined}>
              <div className="bucket-card-header">
                <h3 className="cell-with-icon">
                  <span className="bucket-ico">
                    <BucketIcon name={b.name} iconKey={b.icon_key} />
                  </span>
                  {b.name}
                </h3>
                {confirmingDeleteId === b.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn-danger" onClick={() => onDeleteBucket(b.id)}>
                      Delete
                    </button>
                  </span>
                ) : (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setEditingId(b.id)}>
                      Edit
                    </button>
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(b.id)}>
                      Delete
                    </button>
                  </span>
                )}
              </div>
              <p className="bucket-saved">
                {formatAmount(b.saved_amount)}
                {b.target_amount && <span className="bucket-target"> of {formatAmount(b.target_amount)}</span>}
              </p>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct ?? 100}%`, background: b.color ?? undefined }}></div>
              </div>
              <p className="bucket-meta-row">
                <span>{pct !== null ? `${Math.round(pct)}% funded` : "No target"}</span>
                <span>{b.target_date ? `${daysLeft(b.target_date)} days left` : "—"}</span>
              </p>
              {(b.account_name || b.member_name) && (
                <p className="bucket-target">
                  {b.account_name && `${b.account_name}`}
                  {b.account_name && b.member_name && " · "}
                  {b.member_name && `${b.member_name}`}
                </p>
              )}
              {b.sinking_amount && (
                <p className="bucket-target" title="Automatically added to this bucket once a month">
                  Auto: {formatAmount(b.sinking_amount)}/mo
                </p>
              )}
              {editingId === b.id ? (
                <EditBucketForm
                  bucket={b}
                  accounts={accounts}
                  onCancel={() => setEditingId(null)}
                  onSave={(targetAmount, targetDate, accountId, sinkingAmount, color, iconKey) => {
                    onUpdateBucketDetails(b.id, targetAmount, targetDate, accountId, sinkingAmount, color, iconKey);
                    setEditingId(null);
                  }}
                />
              ) : (
                <ContributionForm bucketId={b.id} onAddContribution={onAddContribution} />
              )}
            </div>
          );
        })}
        <NewBucketForm accounts={accounts} familyMembers={familyMembers} onCreate={onCreateBucket} />
      </div>
    </div>
  );
}
