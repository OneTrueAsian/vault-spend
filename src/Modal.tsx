import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatAmount, isValidDecimalString, toLocalIsoDate } from "./format";
import type { Account, Bucket, CategoryTransaction, FamilyMember, Holding, MonthExpenseDetail, ReportBudgetLine, Transaction } from "./types";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { isBeforeAccountCheckpoint } from "./accountGroups";
import { effectiveBudget } from "./budgetPlan";
import { accountWidgetId, bucketWidgetId, investmentWidgetId, WIDGET_CATALOG, type WidgetId } from "./dashboardLayout";
import {
  AccountTypeIcon,
  ACCOUNT_ICON_OPTIONS,
  type AccountIconKey,
  CategoryIcon,
  CATEGORY_ICON_OPTIONS,
  isCategoryIconKey,
  type CategoryIconKey,
  IconPicker,
} from "./icons";

/** Shared shell: a dimmed overlay behind a centered panel. Clicking the
 * overlay (not the panel) cancels, matching how a native dialog behaves —
 * Escape does too, and focus moves onto the panel on open, since every
 * dialog in the app goes through this one component (fixing it here fixes
 * all of them, rather than needing this in each of the ~20 dialogs below).
 * Tab/Shift+Tab are trapped within the panel while it's open, and focus is
 * restored to whatever had it beforehand once the dialog closes — without
 * this, a keyboard or screen-reader user could Tab straight out of any
 * dialog into the sidebar behind the overlay. */
export function ModalShell({
  title,
  onCancel,
  children,
  wide,
  headerAction,
  footer,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
  /** Content-heavy dialogs (a scrollable list, a table) need more room than
   * a plain form does — pass `wide` rather than growing every modal. */
  wide?: boolean;
  /** Something for the top right of the header row (a Close button). */
  headerAction?: React.ReactNode;
  /** Pins these controls below a body that scrolls on its own: the header and
   * the footer stay on screen however small the window or long the content. */
  footer?: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Captured at construction time, before the panel (or any descendant
  // `autoFocus` input) takes focus — reading `document.activeElement`
  // inside the effect below would be too late, since React has already
  // applied `autoFocus` by the time an effect runs.
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  // `onCancel` is a fresh inline closure from the caller on every render of
  // *their* component (not this one) — if it were a dependency below, any
  // unrelated re-render of the caller while the dialog is open would fire
  // this effect's cleanup (restoring focus to whatever was focused before
  // the dialog opened) and then immediately re-run the mount logic, which
  // steals focus back onto the inert panel instead of the field the caller
  // put `autoFocus` on. Reading it via a ref keeps the effect itself tied
  // only to the dialog's own mount/unmount.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  // In dev (`tauri dev`'s Vite dev server), `<StrictMode>` in main.tsx
  // deliberately double-invokes every effect on mount — setup, cleanup,
  // setup again — to surface exactly this kind of bug. Production builds
  // (what the e2e suite drives) don't do this, which is why this only
  // shows up when running against the dev server. Tracking any pending
  // restore-focus call here, so a setup re-run can cancel it, is what
  // makes the sequence below a no-op instead of stealing focus.
  const pendingRestoreRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingRestoreRef.current !== null) {
      clearTimeout(pendingRestoreRef.current);
      pendingRestoreRef.current = null;
    }
    // Several dialogs have their own `autoFocus` input, which — being a
    // descendant — mounts and claims focus before this effect runs; only
    // take focus here if nothing inside the panel already has it, so this
    // doesn't yank focus away from that input back onto the inert panel.
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // A basic focus trap: Tab/Shift+Tab cycle within the dialog's own
      // focusable elements instead of leaking into the page behind the
      // overlay — queried fresh on every press since a dialog's own
      // contents can change while it's open (a field appearing/disabling).
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const atEdgeOrOutside = e.shiftKey
        ? active === first || !panelRef.current.contains(active)
        : active === last || !panelRef.current.contains(active);
      if (atEdgeOrOutside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Deferred rather than called inline: an inline call here would
      // fire on StrictMode's simulated dev-only cleanup too, moving
      // focus off the dialog's autoFocus field a tick before the setup
      // above re-runs and — finding focus outside the panel — grabs it
      // onto the inert panel div instead, permanently losing the
      // autoFocus target even though the dialog never really closed.
      // Scheduling it lets that re-run's `clearTimeout` above cancel it
      // first on a false alarm; on a real close there's no re-run to
      // cancel it, so it still fires, just one tick later.
      pendingRestoreRef.current = window.setTimeout(() => {
        pendingRestoreRef.current = null;
        previouslyFocusedRef.current?.focus();
      }, 0);
    };
    // Mount/unmount only — see the comment on `onCancelRef` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rendered into <body>, not where it's used: a dialog is `position: fixed`,
  // and any filtered ancestor (the Transparent style's `backdrop-filter` on
  // `.page`) becomes its containing block — laying it out against the whole
  // scrolled page instead of the window, so it could sit mostly off-screen.
  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div
        ref={panelRef}
        className={["modal-panel", wide ? "modal-panel-wide" : "", footer ? "modal-panel-fixed-chrome" : ""].filter(Boolean).join(" ")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {headerAction ? (
          <div className="modal-header">
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {headerAction}
          </div>
        ) : (
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
        )}
        {footer ? (
          <>
            <div className="modal-body">{children}</div>
            <div className="modal-footer">{footer}</div>
          </>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  );
}

export function WelcomeDialog({
  onExploreHelp,
  onGetStarted,
}: {
  onExploreHelp: () => void;
  onGetStarted: () => void;
}) {
  return (
    <ModalShell title="Welcome to Vault Spend" onCancel={onGetStarted}>
      <p className="modal-message">
        Own your Data, Own your Money! Before you dive in, would you like a quick
        tour of how everything works?
      </p>
      <p className="modal-message modal-message-secondary">
        You can always come back to this from the Help tab in the sidebar.
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onGetStarted}>
          Just get started
        </button>
        <button type="button" onClick={onExploreHelp}>
          Explore Help
        </button>
      </div>
    </ModalShell>
  );
}

export function WhatsNewDialog({
  version,
  notes,
  onClose,
}: {
  version: string;
  notes: string[];
  onClose: () => void;
}) {
  return (
    <ModalShell title={`What's new in ${version}`} onCancel={onClose} wide>
      <ul className="modal-changelog-list">
        {notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </ModalShell>
  );
}

const ACCOUNT_TYPE_OPTIONS = ["checking", "savings", "credit", "loan", "investment", "other"];

export function NewAccountDialog({
  familyMembers,
  onCancel,
  onSubmit,
}: {
  familyMembers: FamilyMember[];
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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
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
          />
        </label>
        <label className="modal-field">
          <span>Account type</span>
          <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            {ACCOUNT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
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
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Unassigned</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()}>
            Create account
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function NewCategoryDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, iconKey: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState<CategoryIconKey | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), iconKey);
  }

  return (
    <ModalShell title="New category" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Category name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Pet Care"'
          />
        </label>
        <label className="modal-field">
          <span>Icon (optional)</span>
          <IconPicker
            options={CATEGORY_ICON_OPTIONS}
            value={iconKey}
            onChange={setIconKey}
            renderIcon={(key) => <CategoryIcon category={name} iconKey={key} />}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()}>
            Add category
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/** The Transactions tab's "Add transaction…" — the one way to get a single
 * transaction in without a file import (see `App.tsx`'s
 * `handleCreateManualTransaction`). Leaving Category on "Auto-categorize"
 * runs it through the same categorization pass an import row gets; picking
 * one explicitly skips that. There's no inline "+ New category…" here
 * (unlike the Transactions tab's own row-level category dropdown) — every other
 * `askX()` dialog in this app is top-level, never nested inside another
 * modal, and leaving Category blank plus correcting it afterward via that
 * existing per-row dropdown already covers "I want a brand-new category"
 * without introducing a new stacked-modal pattern just for this form. */
export function NewTransactionDialog({
  accounts,
  categories,
  familyMembers,
  defaultAccountId,
  budgetActuals,
  onCancel,
  onSubmit,
}: {
  accounts: Account[];
  categories: string[];
  familyMembers: FamilyMember[];
  defaultAccountId: number | null;
  /** Current calendar month's budget-vs-actual (from `report`, which
   * `get_report` always computes for *today's* month regardless of what
   * the Budget page happens to be scrolled to) — reused here rather than
   * a new fetch, to show "$602 of $700 used — $98 left" live as the user
   * picks a category. Deliberately not `budgetMonthActuals` (the Budget
   * page's own state): that one only populates after the Budget tab has
   * been visited, which this dialog is opened without needing to. */
  budgetActuals: ReportBudgetLine[];
  onCancel: () => void;
  onSubmit: (
    accountId: number,
    date: string,
    description: string,
    amount: string,
    category: string | null,
    memberId: number | null,
  ) => void;
}) {
  const [accountId, setAccountId] = useState(
    defaultAccountId !== null ? String(defaultAccountId) : accounts[0] ? String(accounts[0].id) : "",
  );
  const [date, setDate] = useState(() => toLocalIsoDate());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [memberId, setMemberId] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const amountTrimmed = amount.trim();
  const amountIsNumeric = amountTrimmed !== "" && isValidDecimalString(amountTrimmed);
  const amountError = amountTrimmed === "" ? "Enter an amount." : !amountIsNumeric ? "That doesn't look like a number." : null;
  const valid = accountId !== "" && description.trim() !== "" && amountIsNumeric && date !== "";

  const budgetImpact = budgetActuals.find((b) => b.category === category);
  const selectedAccount = accounts.find((a) => String(a.id) === accountId);
  const backdated = selectedAccount ? isBeforeAccountCheckpoint(selectedAccount, date) : false;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!valid) return;
    onSubmit(Number(accountId), date, description.trim(), amountTrimmed, category || null, memberId ? Number(memberId) : null);
  }

  return (
    <ModalShell title="Add transaction" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.length === 0 && <option value="">No accounts yet</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="modal-field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {backdated && selectedAccount && (
            <span className="field-hint field-warning">
              {selectedAccount.name}'s balance was last locked in as of {selectedAccount.checkpoint_date} — this
              transaction won't change today's balance shown on the Accounts page (it still counts in past balance
              history).
            </span>
          )}
        </label>
        <label className="modal-field">
          <span>Description</span>
          <input
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "Coffee shop"'
            aria-invalid={submitAttempted && description.trim() === ""}
          />
          {submitAttempted && description.trim() === "" && <span className="field-error">Enter a description.</span>}
        </label>
        <label className="modal-field">
          <span>Amount</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Negative = money out"
            aria-invalid={submitAttempted && amountError !== null}
          />
          {submitAttempted && amountError && <span className="field-error">{amountError}</span>}
        </label>
        <label className="modal-field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Auto-categorize</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {budgetImpact &&
            (() => {
              const budgeted = effectiveBudget(budgetImpact);
              const actual = parseFloat(budgetImpact.actual);
              const remaining = budgeted - actual;
              return (
                <span className={remaining < 0 ? "field-hint report-over-budget" : "field-hint"}>
                  {formatAmount(budgetImpact.actual)} of {formatAmount(budgeted.toFixed(2))} used this month —{" "}
                  {remaining < 0 ? `${formatAmount((-remaining).toFixed(2))} over budget` : `${formatAmount(remaining.toFixed(2))} left`}
                </span>
              );
            })()}
        </label>
        {familyMembers.length > 0 && (
          <label className="modal-field">
            <span>Family member (optional)</span>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Unassigned</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={accounts.length === 0}>
            Add transaction
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function ManageCategoriesDialog({
  categories,
  categoryIconMap,
  onCancel,
  onCreate,
  onSetIcon,
  onRename,
  onDelete,
}: {
  categories: string[];
  /** Name → explicit icon override, for the swatch shown on each row — see
   * App.tsx's `categoryIconMap`. */
  categoryIconMap: Record<string, string | null>;
  onCancel: () => void;
  onCreate: (name: string, iconKey: string | null) => void;
  onSetIcon: (name: string, iconKey: string | null) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDelete, () => setConfirmingDelete(null));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState<CategoryIconKey | null>(null);
  const [editingIcon, setEditingIcon] = useState<string | null>(null);

  function startEditing(name: string) {
    setConfirmingDelete(null);
    setEditing(name);
    setDraftName(name);
  }

  function commitRename(oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRename(oldName, trimmed);
    }
    setEditing(null);
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    onCreate(trimmed, newCategoryIcon);
    setNewCategoryName("");
    setNewCategoryIcon(null);
  }

  return (
    <ModalShell title="Manage categories" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        Renaming a category to a name that already exists merges the two.
      </p>
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder='New category, e.g. "Pet Care"'
        />
        <button type="submit" disabled={!newCategoryName.trim()}>
          Add
        </button>
      </form>
      {newCategoryName.trim() !== "" && (
        <IconPicker
          options={CATEGORY_ICON_OPTIONS}
          value={newCategoryIcon}
          onChange={setNewCategoryIcon}
          renderIcon={(key) => <CategoryIcon category={newCategoryName} iconKey={key} />}
        />
      )}
      {categories.length === 0 ? (
        <p className="modal-message">No categories in use yet.</p>
      ) : (
        <ul className="category-manage-list">
          {categories.map((name) => {
            const currentIconKey = categoryIconMap[name] ?? null;
            return (
            <li key={name} className="category-manage-row">
              <span className="icon-toggle-anchor">
                <button
                  type="button"
                  className="icon-picker-swatch"
                  title="Click to change this category's icon"
                  aria-label={`Change ${name}'s icon`}
                  onClick={() => setEditingIcon(editingIcon === name ? null : name)}
                >
                  <CategoryIcon category={name} iconKey={currentIconKey} />
                </button>
                {editingIcon === name && (
                  <div className="icon-picker-popover">
                    <IconPicker
                      options={CATEGORY_ICON_OPTIONS}
                      value={currentIconKey && isCategoryIconKey(currentIconKey) ? currentIconKey : null}
                      onChange={(key) => {
                        onSetIcon(name, key);
                        setEditingIcon(null);
                      }}
                      renderIcon={(key) => <CategoryIcon category={name} iconKey={key} />}
                    />
                  </div>
                )}
              </span>
              {editing === name ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(name);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="category-manage-name">{name}</span>
              )}
              {confirmingDelete === name ? (
                <span className="category-manage-confirm">
                  <span className="modal-message-secondary">Delete? Its transactions become Uncategorized.</span>
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-danger" onClick={() => onDelete(name)}>
                    Delete
                  </button>
                </span>
              ) : (
                <span className="category-manage-actions">
                  <button type="button" className="modal-secondary" onClick={() => startEditing(name)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setEditing(null);
                      setConfirmingDelete(name);
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
            );
          })}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}

/** Same interaction pattern as `ManageCategoriesDialog` — a flat named list
 * with inline rename and delete-with-confirm — since a family member is the
 * same shape of thing as a category: a label other data is attributed to,
 * not a container with its own balance or fields. Unlike a category rename,
 * renaming into an existing name is just an error (surfaced by the caller's
 * usual status handling), not a merge — two family members are never the
 * same person. */
export function ManageFamilyMembersDialog({
  members,
  onCancel,
  onCreate,
  onRename,
  onDelete,
}: {
  members: FamilyMember[];
  onCancel: () => void;
  onCreate: (name: string) => void;
  onRename: (id: number, newName: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDelete, () => setConfirmingDelete(null));
  const [newMemberName, setNewMemberName] = useState("");

  function startEditing(member: FamilyMember) {
    setConfirmingDelete(null);
    setEditing(member.id);
    setDraftName(member.name);
  }

  function commitRename(id: number, oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRename(id, trimmed);
    }
    setEditing(null);
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewMemberName("");
  }

  return (
    <ModalShell title="Manage family members" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        Just a label within this one file — everyone still shares the same data. For a completely separate person's
        own data, use Profiles in Settings instead.
      </p>
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newMemberName}
          onChange={(e) => setNewMemberName(e.target.value)}
          placeholder='New family member, e.g. "Alex"'
        />
        <button type="submit" disabled={!newMemberName.trim()}>
          Add
        </button>
      </form>
      {members.length === 0 ? (
        <p className="modal-message">No family members yet.</p>
      ) : (
        <ul className="category-manage-list">
          {members.map((member) => (
            <li key={member.id} className="category-manage-row">
              {editing === member.id ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(member.id, member.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(member.id, member.name);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="category-manage-name">{member.name}</span>
              )}
              {confirmingDelete === member.id ? (
                <span className="category-manage-confirm">
                  <span className="modal-message-secondary">
                    Delete? Anything attributed to {member.name} becomes unassigned.
                  </span>
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-danger" onClick={() => onDelete(member.id)}>
                    Delete
                  </button>
                </span>
              ) : (
                <span className="category-manage-actions">
                  <button type="button" className="modal-secondary" onClick={() => startEditing(member)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setEditing(null);
                      setConfirmingDelete(member.id);
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}

export function MonthExpenseDetailDialog({
  detail,
  onClose,
}: {
  detail: MonthExpenseDetail;
  onClose: () => void;
}) {
  const maxCategory = detail.categories.length ? parseFloat(detail.categories[0].amount) : 1;

  return (
    <ModalShell title={`${detail.month_label} expenses`} onCancel={onClose} wide>
      {detail.categories.length === 0 ? (
        <p className="empty-state">No expenses this month.</p>
      ) : (
        <div style={{ marginBottom: 18 }}>
          {detail.categories.map((c) => (
            <div key={c.category} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>{c.category}</span>
                <span className="amount-col">{formatAmount(c.amount)}</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${(parseFloat(c.amount) / maxCategory) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="modal-message-secondary" style={{ fontWeight: 700, marginBottom: 8 }}>
        Large expenses
      </p>
      {detail.large_expenses.length === 0 ? (
        <p className="modal-message modal-message-secondary">Nothing stood out as unusually large this month.</p>
      ) : (
        <ul className="large-expense-list">
          {detail.large_expenses.map((e) => (
            <li key={e.transaction_id} className="large-expense-row">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>{e.description}</span>
                <span className="amount-col">{formatAmount(e.amount)}</span>
              </div>
              <div className="modal-message-secondary">{e.detail}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}

export function CategoryTransactionsDialog({
  category,
  monthLabel,
  transactions,
  categoryOptions,
  onCorrectCategory,
  onBulkCorrectCategory,
  onClose,
}: {
  category: string;
  monthLabel: string;
  transactions: CategoryTransaction[];
  categoryOptions: string[];
  /** Reconciles a miscategorized whole transaction — not offered for a
   * split line (`is_split`), since a split's category lives on its own
   * split row, edited via the Transactions tab's "Edit splits" flow instead. */
  onCorrectCategory: (transactionId: number, category: string) => void;
  /** Resolves once the change has actually been applied (or `false` if
   * the user backed out of an in-flight "+ New category…" prompt, or the
   * call failed) — the selection only clears on a real success, same as
   * the Transactions tab's own bulk bar. */
  onBulkCorrectCategory: (transactionIds: number[], category: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Only whole transactions can be bulk-recategorized this way — a split
  // line's category lives on its own split row (see onCorrectCategory's
  // note above), so it never gets a checkbox here either.
  const selectableIds = transactions.filter((t) => !t.is_split).map((t) => t.transaction_id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleBulkChange(value: string) {
    if (!value) return;
    const applied = await onBulkCorrectCategory(Array.from(selectedIds), value);
    if (applied) setSelectedIds(new Set());
  }

  return (
    <ModalShell title={`${category} — ${monthLabel}`} onCancel={onClose} wide>
      {transactions.length === 0 ? (
        <p className="empty-state">No transactions in this category this month.</p>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="bulk-actions-bar">
              <span className="bulk-actions-count">{selectedIds.size} selected</span>
              <select value="" onChange={(e) => handleBulkChange(e.target.value)}>
                <option value="" disabled>
                  Set category to…
                </option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__new__">+ New category…</option>
              </select>
              <button type="button" className="modal-secondary" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
            </div>
          )}
          <div className="modal-table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="select-col">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                      disabled={selectableIds.length === 0}
                    />
                  </th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th className="amount-col">Amount</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr
                    key={`${t.transaction_id}-${i}`}
                    className={selectedIds.has(t.transaction_id) ? "ledger-row-selected" : undefined}
                  >
                    <td className="select-col">
                      {!t.is_split && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.transaction_id)}
                          onChange={() => toggleSelected(t.transaction_id)}
                          aria-label={`Select transaction ${t.transaction_id}`}
                        />
                      )}
                    </td>
                    <td>{t.date}</td>
                    <td>
                      {t.description}
                      {t.is_split && (
                        <span className="split-summary"> (split{t.split_note ? `: ${t.split_note}` : ""})</span>
                      )}
                    </td>
                    <td>{t.account_name}</td>
                    <td className="amount-col">{formatAmount(t.amount)}</td>
                    <td>
                      {t.is_split ? (
                        <span className="modal-message-secondary" title="Edit a split's category from the Transactions tab's Edit splits screen">
                          {category}
                        </span>
                      ) : (
                        <select value={category} onChange={(e) => onCorrectCategory(t.transaction_id, e.target.value)}>
                          {!categoryOptions.includes(category) && <option value={category}>{category}</option>}
                          {categoryOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                          <option value="__new__">+ New category…</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}

/** The last step of "Use existing file…" in Settings → Profiles: the native
 * file picker (driven by `App.tsx`, same as every other file-open in this
 * app) has already returned `path`; this just asks what to call the new
 * profile before registering it. Mirrors `NewAccountDialog`'s shape more
 * than `ProfilesSection`'s own inline "New profile…" form, since a picked
 * file (unlike a brand-new empty profile) needs its path shown so the user
 * can confirm it's the right one before it becomes live. */
export function UseExistingDataFileDialog({
  path,
  onCancel,
  onSubmit,
}: {
  path: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
  }

  return (
    <ModalShell title="Use an existing data file" onCancel={onCancel}>
      <p className="modal-message-secondary" style={{ userSelect: "text", wordBreak: "break-all" }}>
        {path}
      </p>
      <p className="modal-message modal-message-secondary">
        Vault Spend will start using this file right away, registered as a new profile you can switch away from
        anytime. The file stays exactly where it is — nothing is copied or moved.
      </p>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Profile name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Old Laptop"'
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()}>
            Use this file
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function ConfirmInvertDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Which way do the amounts go?" onCancel={onCancel}>
      <p className="modal-message">
        Does this file show charges as positive amounts, like a credit card
        statement (with payments shown as negative)?
      </p>
      <p className="modal-message modal-message-secondary">
        Choose "Flip the signs" to match the rest of your transactions (negative =
        money out). Choose "Keep as-is" if it already uses that convention —
        most bank/checking exports do.
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Keep as-is
        </button>
        <button type="button" onClick={onConfirm}>
          Flip the signs
        </button>
      </div>
    </ModalShell>
  );
}

/** One "pick a specific account/bucket/investment account, then Add" row
 * inside the "Pin a specific item" group below — a `<select>` since the
 * options are open-ended (however many accounts/buckets the user has),
 * unlike the fixed catalog rows above which are just a static "Add"
 * button per row. */
function PinItemRow<T>({
  label,
  options,
  getKey,
  getLabel,
  onAdd,
}: {
  label: string;
  options: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onAdd: (item: T) => void;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const selectedItem = options.find((o) => getKey(o) === selectedKey);

  return (
    <li className="category-manage-row">
      <span className="category-manage-name">{label}</span>
      {options.length === 0 ? (
        <span className="modal-message-secondary">None available</span>
      ) : (
        <>
          <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={getKey(o)} value={getKey(o)}>
                {getLabel(o)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="modal-secondary"
            disabled={!selectedItem}
            onClick={() => {
              if (!selectedItem) return;
              onAdd(selectedItem);
              setSelectedKey("");
            }}
          >
            Add
          </button>
        </>
      )}
    </li>
  );
}

/** Two catalog groups — the 9 always-available core widgets, and the 4
 * report sections that can also be pinned here from their home tab (Cash
 * Flow, Investments, Reports) — plus a "Pin a specific item" picker for
 * one particular account/bucket/investment account, since those aren't a
 * bounded catalog. Adding a catalog widget here is the exact same action
 * as clicking "Pin to Dashboard" on its home tab — both just add the id to
 * the layout — so a widget already on the Dashboard shows "Added" instead
 * of a duplicate Add button, and clicking Add doesn't close the dialog,
 * so more than one can be added in a row. */
export function AddWidgetDialog({
  currentWidgets,
  accounts,
  buckets,
  holdings,
  onAdd,
  onCancel,
}: {
  currentWidgets: WidgetId[];
  accounts: Account[];
  buckets: Bucket[];
  holdings: Holding[];
  onAdd: (id: WidgetId) => void;
  onCancel: () => void;
}) {
  const groups: { title: string; items: typeof WIDGET_CATALOG }[] = [
    { title: "Core widgets", items: WIDGET_CATALOG.filter((w) => w.group === "core") },
    { title: "Pinned reports", items: WIDGET_CATALOG.filter((w) => w.group === "report") },
  ];

  const pinnableAccounts = accounts.filter((a) => !currentWidgets.includes(accountWidgetId(a.id)));
  const pinnableBuckets = buckets.filter((b) => !currentWidgets.includes(bucketWidgetId(b.id)));
  const investmentAccountNames = Array.from(new Set(holdings.map((h) => h.account_name))).sort();
  const pinnableInvestmentAccounts = investmentAccountNames.filter((name) => !currentWidgets.includes(investmentWidgetId(name)));

  return (
    <ModalShell title="Add widget" onCancel={onCancel} wide>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="modal-message-secondary widget-group-title">{g.title}</p>
          <ul className="category-manage-list widget-catalog-list">
            {g.items.map((w) => {
              const added = currentWidgets.includes(w.id);
              return (
                <li key={w.id} className="category-manage-row">
                  <span className="category-manage-name">{w.label}</span>
                  <button type="button" className="modal-secondary" disabled={added} onClick={() => onAdd(w.id)}>
                    {added ? "Added" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div>
        <p className="modal-message-secondary widget-group-title">Pin a specific item</p>
        <ul className="category-manage-list">
          <PinItemRow
            label="Account"
            options={pinnableAccounts}
            getKey={(a) => String(a.id)}
            getLabel={(a) => a.name}
            onAdd={(a) => onAdd(accountWidgetId(a.id))}
          />
          <PinItemRow
            label="Goal"
            options={pinnableBuckets}
            getKey={(b) => String(b.id)}
            getLabel={(b) => b.name}
            onAdd={(b) => onAdd(bucketWidgetId(b.id))}
          />
          <PinItemRow
            label="Investment account"
            options={pinnableInvestmentAccounts}
            getKey={(name) => name}
            getLabel={(name) => name}
            onAdd={(name) => onAdd(investmentWidgetId(name))}
          />
        </ul>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}

export type RulePreview = { matching: number; would_change: number };

/** Create or edit one categorization rule: "when a description contains X,
 * make it category Y". Shows — live, before anything is saved — how many
 * transactions already on the books that would re-categorize, and offers to
 * do it in the same step. Transactions you categorized yourself are never
 * touched (the backend excludes them from the count too). */
export function RuleEditorDialog({
  categories,
  initial,
  onPreview,
  onSubmit,
  onCancel,
}: {
  categories: string[];
  /** The rule being edited, or `null` for a brand-new one. */
  initial: { pattern: string; category: string } | null;
  onPreview: (pattern: string, category: string) => Promise<RulePreview>;
  onSubmit: (pattern: string, category: string, applyToExisting: boolean) => void;
  onCancel: () => void;
}) {
  const [pattern, setPattern] = useState(initial?.pattern ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [applyToExisting, setApplyToExisting] = useState(true);
  const datalistId = useId();

  // Latest `onPreview` without making it an effect dependency — the parent
  // hands in a fresh closure every render, and re-running the debounce on
  // each one would mean the preview never settles.
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(() => {
    if (!pattern.trim() || !category.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      onPreviewRef
        .current(pattern, category)
        .then((p) => {
          if (!cancelled) setPreview(p);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pattern, category]);

  const wouldChange = preview?.would_change ?? 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pattern.trim() || !category.trim()) return;
    onSubmit(pattern.trim(), category.trim(), applyToExisting && wouldChange > 0);
  }

  return (
    <ModalShell title={initial ? "Edit rule" : "New rule"} onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>When a transaction's description contains</span>
          <input
            autoFocus
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder='e.g. "Ferrywood Coffee"'
          />
        </label>
        <label className="modal-field">
          <span>Give it this category</span>
          <input
            list={datalistId}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Pick one, or type a new one"
          />
          <datalist id={datalistId}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <p className="modal-message modal-message-secondary" data-rule-preview={preview ? "ready" : "none"}>
          {preview === null
            ? "Matching is not case-sensitive, and the longest matching text wins when two rules overlap."
            : preview.matching === 0
              ? "No existing transactions contain this text — it will apply to future imports."
              : `${preview.matching} existing transaction${preview.matching === 1 ? " contains" : "s contain"} this text; ${
                  wouldChange === 0 ? "none need changing" : `${wouldChange} would be re-categorized`
                }. Ones you categorized yourself are never changed.`}
        </p>
        {wouldChange > 0 && (
          <label className="modal-field modal-field-inline">
            <input type="checkbox" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} />
            <span>
              Also re-categorize those {wouldChange} transaction{wouldChange === 1 ? "" : "s"} now
            </span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!pattern.trim() || !category.trim()}>
            Save rule
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

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
}: {
  account: Account;
  familyMembers: FamilyMember[];
  onSave: (changes: { accountType?: string; memberId?: number | null; institution?: string | null; mask?: string | null }) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [accountType, setAccountType] = useState(account.account_type);
  const [memberId, setMemberId] = useState<number | null>(account.member_id);
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [mask, setMask] = useState(account.mask ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
          <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            {ACCOUNT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </label>
        {familyMembers.length > 0 && (
          <label className="modal-field">
            <span>Family member</span>
            <select value={memberId ?? ""} onChange={(e) => setMemberId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
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
              Delete account…
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

/** "Review possible transfers" — pairs of transactions that look like the two
 * legs of one move of money between the user's own accounts (equal amounts,
 * opposite directions, different accounts, within a few days). Each starts
 * ticked; unticking one leaves it as ordinary spending/income (and it'll be
 * suggested again next time — nothing here is remembered until you link). */
export function TransferReviewDialog({
  pairs,
  onLink,
  onCancel,
}: {
  pairs: { out: Transaction; in: Transaction }[];
  onLink: (pairs: { out_id: number; in_id: number }[]) => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(pairs.map((p) => p.out.id)));

  function toggle(outId: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(outId)) next.delete(outId);
      else next.add(outId);
      return next;
    });
  }

  const chosen = pairs.filter((p) => checked.has(p.out.id));

  return (
    <ModalShell title="Possible transfers" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        These look like money moving between your own accounts. Linking a pair keeps both sides out of your income and
        spending totals, and shows them as one row in Transactions. You can unlink any time.
      </p>
      <ul className="transfer-review-list">
        {pairs.map((p) => {
          const days = Math.abs(Math.round((Date.parse(p.out.date) - Date.parse(p.in.date)) / 86_400_000));
          return (
            <li key={p.out.id}>
              <label className="transfer-review-row">
                <input type="checkbox" checked={checked.has(p.out.id)} onChange={() => toggle(p.out.id)} />
                <span className="transfer-review-when">{p.out.date}</span>
                <span className="transfer-review-what">
                  {p.out.account_name} → {p.in.account_name}
                </span>
                <span className="transfer-review-amount">{formatAmount(p.in.amount)}</span>
                <span className="transfer-review-note">{days === 0 ? "same day" : `${days} day${days === 1 ? "" : "s"} apart`}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Not now
        </button>
        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={() => onLink(chosen.map((p) => ({ out_id: p.out.id, in_id: p.in.id })))}
        >
          Link {chosen.length} as {chosen.length === 1 ? "a transfer" : "transfers"}
        </button>
      </div>
    </ModalShell>
  );
}
