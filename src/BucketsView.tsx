import "./BudgetAndGoals.css";
import { FormEvent, useState } from "react";
import type { Account, Bucket, FamilyMember } from "./types";
import { formatAmount, formatDisplayDate, formatMonthYear, toLocalIsoDate } from "./format";
import { DateField } from "./DateField";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { BUCKET_ICON_OPTIONS, BucketIcon, isBucketIconKey, type BucketIconKey } from "./icons";
import { goalPlan, type GoalPlan } from "./goalPlan";
import { usePopover } from "./usePopover";
import { MenuSelect } from "./MenuSelect";

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

/** Open state lives in `BucketsView`, so the empty page's "Create a goal" and example buttons can
 * open this form (with `initialName` filled in) from outside it. */
function NewBucketForm({
  accounts,
  familyMembers,
  open,
  onOpenChange,
  initialName,
  onCreate,
}: {
  accounts: Account[];
  familyMembers: FamilyMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreate: (
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
    tracksAccount: boolean,
  ) => void;
}) {
  // The empty page mounts this form already open, so the name starts from `initialName` too.
  const [name, setName] = useState(initialName ?? "");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sinkingAmount, setSinkingAmount] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [iconKey, setIconKey] = useState<BucketIconKey | null>(null);
  const [tracksAccount, setTracksAccount] = useState(false);
  // An example name replaces the name field each time the form opens with one; opening without one
  // keeps whatever is already in the field, like the other fields.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && initialName) setName(initialName);
  }

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
      tracksAccount && accountId !== "",
    );
    setName("");
    setTarget("");
    setTargetDate("");
    setAccountId("");
    setMemberId("");
    setSinkingAmount("");
    setColor(null);
    setIconKey(null);
    setTracksAccount(false);
    onOpenChange(false);
  }

  if (!open) {
    return (
      <button type="button" className="add-tile" onClick={() => onOpenChange(true)}>
        <span className="add-tile-plus" aria-hidden="true">+</span>
        New goal…
      </button>
    );
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Emergency Fund"' />
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target amount (optional)" />
      <DateField value={targetDate} onChange={setTargetDate} ariaLabel="Target date (optional)" placeholder="Target date (optional)" title="Target date" />
      <MenuSelect
        ariaLabel="Linked account"
        value={accountId}
        onChange={setAccountId}
        options={[
          { value: "", label: "No linked account" },
          ...accounts.map((a) => ({ value: String(a.id), label: a.name })),
        ]}
        fill
      />
      {accountId !== "" && (
        <label className="bucket-track-toggle">
          <input type="checkbox" checked={tracksAccount} onChange={(e) => setTracksAccount(e.target.checked)} />
          Progress follows this account's balance
        </label>
      )}
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
        <button type="button" className="modal-secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const GOAL_EXAMPLES = ["Emergency fund", "Holiday", "New car"];

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
    tracksAccount: boolean,
  ) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(bucket.target_amount ?? "");
  const [tracksAccount, setTracksAccount] = useState(bucket.tracks_account);
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
      tracksAccount && accountId !== "",
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
      <DateField value={targetDate} onChange={setTargetDate} ariaLabel="Target date (optional)" placeholder="Target date (optional)" title="Target date" />
      <MenuSelect
        ariaLabel="Linked account"
        value={accountId}
        onChange={setAccountId}
        options={[
          { value: "", label: "No linked account" },
          ...accounts.map((a) => ({ value: String(a.id), label: a.name })),
        ]}
        fill
      />
      {accountId !== "" && (
        <label className="bucket-track-toggle">
          <input type="checkbox" checked={tracksAccount} onChange={(e) => setTracksAccount(e.target.checked)} />
          Progress follows this account's balance
        </label>
      )}
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

/** "+ Add" on a goal card: the amount and note inputs used to sit on every
 * card all the time; now they open on demand, so a page of goals reads as
 * progress rather than a wall of empty inputs. */
function ContributePopover({
  bucketId,
  onAddContribution,
}: {
  bucketId: number;
  onAddContribution: (bucketId: number, date: string, amount: string, note: string | null) => void;
}) {
  const today = toLocalIsoDate();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { open, setOpen, rootRef, triggerRef } = usePopover();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount.trim()) return;
    onAddContribution(bucketId, today, amount.trim(), note.trim() ? note.trim() : null);
    setAmount("");
    setNote("");
    setOpen(false);
  }

  return (
    <div className="bucket-contribute" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="modal-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        + Add
      </button>
      {open && (
        <form className="bucket-contribute-panel" onSubmit={handleSubmit}>
          <input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (negative = withdrawal)"
            aria-label="Contribution amount"
            className="text-input"
          />
          <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Contribution note" />
          <div className="bucket-new-form-actions">
            <button type="submit" disabled={!amount.trim()}>
              Add
            </button>
            <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** "Jun 2027" / "Dec 18" (or "Dec 18, 2027" for another year) from a stored "YYYY-MM-DD". */
function shortDate(iso: string, withDay: boolean): string {
  return withDay ? formatDisplayDate(iso) : formatMonthYear(iso);
}

/** The projection lines under a goal's progress bar: where the recent pace
 * lands, and — when there's a target date — what it would take to make it. */
function GoalPlanLines({ plan, targetDate }: { plan: GoalPlan; targetDate: string | null }) {
  if (plan.status === "no_target") return null;
  if (plan.status === "reached") {
    return (
      <p className="goal-plan" data-goal-status="reached">
        <span className="goal-badge goal-badge-good">Goal reached</span>
      </p>
    );
  }
  const badge =
    plan.status === "on_track" ? (
      <span className="goal-badge goal-badge-good">On track</span>
    ) : plan.status === "behind" ? (
      <span className="goal-badge goal-badge-warn">Behind</span>
    ) : null;
  return (
    <p className="goal-plan" data-goal-status={plan.status}>
      {badge}
      <span className="goal-plan-text">
        {plan.projectedFinish
          ? `At your recent pace: ${shortDate(plan.projectedFinish, false)}`
          : "No recent progress to project from"}
        {plan.needsPerMonth !== null && targetDate && (
          <>
            {" · "}
            <span data-goal-needs>needs ${Math.ceil(plan.needsPerMonth).toLocaleString("en-US")}/mo</span> to reach it by{" "}
            {shortDate(targetDate, true)}
          </>
        )}
      </span>
    </p>
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
    tracksAccount: boolean,
  ) => void;
  onUpdateBucketDetails: (
    id: number,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
    tracksAccount: boolean,
  ) => void;
  onAddContribution: (bucketId: number, date: string, amount: string, note: string | null) => void;
  onDeleteBucket: (id: number) => void;
}) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newGoalName, setNewGoalName] = useState("");
  const today = new Date();

  function openNewGoal(name: string) {
    setNewGoalName(name);
    setNewGoalOpen(true);
  }

  function changeNewGoalOpen(open: boolean) {
    setNewGoalOpen(open);
    if (!open) setNewGoalName("");
  }

  const newGoalForm = (
    <NewBucketForm
      accounts={accounts}
      familyMembers={familyMembers}
      open={newGoalOpen}
      onOpenChange={changeNewGoalOpen}
      initialName={newGoalName}
      onCreate={onCreateBucket}
    />
  );

  if (buckets.length === 0) {
    return (
      <div className="buckets-view">
        <div className="page-top">
          <div>
            <h1 className="view-title">Goals</h1>
            <p className="view-sub">Money you're setting aside for something, like a holiday or a yearly bill.</p>
          </div>
        </div>
        <div className="goals-empty">
          {newGoalOpen ? (
            newGoalForm
          ) : (
            <>
              <h2>No goals yet</h2>
              <p>Save toward something: a holiday, a new car, an emergency fund.</p>
              <button type="button" onClick={() => openNewGoal("")}>
                Create a goal
              </button>
              <div className="goals-empty-examples" role="group" aria-label="Start from an example">
                {GOAL_EXAMPLES.map((example) => (
                  <button key={example} type="button" className="modal-secondary" onClick={() => openNewGoal(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="buckets-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Goals</h1>
          <p className="view-sub">Money you're setting aside for something, like a holiday or a yearly bill.</p>
        </div>
      </div>
      <div className="buckets-grid">
        {buckets.map((b) => {
          const saved = parseFloat(b.saved_amount);
          const target = b.target_amount ? parseFloat(b.target_amount) : null;
          const pct = target && target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : null;
          const plan = goalPlan(b, today);
          return (
            <div key={b.id} className="bucket-card" style={b.color ? { borderTop: `3px solid ${b.color}` } : undefined}>
              <div className="bucket-card-header">
                <h2 className="cell-with-icon">
                  <span className="bucket-ico">
                    <BucketIcon name={b.name} iconKey={b.icon_key} />
                  </span>
                  {b.name}
                </h2>
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
              <GoalPlanLines plan={plan} targetDate={b.target_date} />
              {(b.account_name || b.member_name) && (
                <p className="bucket-target">
                  {b.account_name && (b.tracks_account ? `Follows the ${b.account_name} balance` : `${b.account_name}`)}
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
                  onSave={(targetAmount, targetDate, accountId, sinkingAmount, color, iconKey, tracksAccount) => {
                    onUpdateBucketDetails(b.id, targetAmount, targetDate, accountId, sinkingAmount, color, iconKey, tracksAccount);
                    setEditingId(null);
                  }}
                />
              ) : b.tracks_account && b.account_id !== null ? null : (
                <ContributePopover bucketId={b.id} onAddContribution={onAddContribution} />
              )}
            </div>
          );
        })}
        {newGoalForm}
      </div>
    </div>
  );
}
