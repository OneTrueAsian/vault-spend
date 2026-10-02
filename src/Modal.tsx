import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatAmount, isValidDecimalString, toLocalIsoDate } from "./format";
import type { Account, Bucket, CategoryTransaction, FamilyMember, Holding, MonthExpenseDetail, ReportBudgetLine, Transaction } from "./types";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { isBeforeAccountCheckpoint } from "./accountGroups";
import { effectiveBudget } from "./budgetPlan";
import { accountWidgetId, bucketWidgetId, investmentWidgetId, WIDGET_CATALOG, type WidgetId } from "./dashboardLayout";
import { PasswordForm } from "./PasswordForm";
import { MenuSelect } from "./MenuSelect";
import type { ImportSignSuggestion } from "./importSigns";
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
import { errorMessage } from "./errorMessage";

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
    // Captured once when the dialog opened (the ref is never reassigned); read here so the deferred
    // restore below focuses that element.
    const previouslyFocused = previouslyFocusedRef.current;
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
        previouslyFocused?.focus();
      }, 0);
    };
    // Mount/unmount only — see the comment on `onCancelRef` above.
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
    notes: string | null,
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
  const [notes, setNotes] = useState("");
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
    onSubmit(
      Number(accountId),
      date,
      description.trim(),
      amountTrimmed,
      category || null,
      memberId ? Number(memberId) : null,
      notes.trim() === "" ? null : notes,
    );
  }

  return (
    <ModalShell title="Add transaction" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Account</span>
          <MenuSelect
            ariaLabel="Account"
            value={accountId}
            onChange={setAccountId}
            options={[
              ...(accounts.length === 0 ? [{ value: "", label: "No accounts yet" }] : []),
              ...accounts.map((a) => ({ value: String(a.id), label: a.name })),
            ]}
            fill
          />
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
          <MenuSelect
            ariaLabel="Category"
            value={category}
            onChange={setCategory}
            options={[
              { value: "", label: "Auto-categorize" },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
            fill
          />
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
        <label className="modal-field">
          <span>Note (optional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
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
              <MenuSelect
                ariaLabel="Set category to…"
                placeholder="Set category to…"
                value={""}
                onChange={handleBulkChange}
                options={[
                  ...categoryOptions.map((c) => ({ value: c, label: c })),
                  { value: "__new__", label: "+ New category…" },
                ]}
              />
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
                        <MenuSelect
                          ariaLabel={`Category for "${t.description}"`}
                          value={category}
                          onChange={(v) => onCorrectCategory(t.transaction_id, v)}
                          options={[
                            ...(!categoryOptions.includes(category) ? [{ value: category, label: category }] : []),
                            ...categoryOptions.map((c) => ({ value: c, label: c })),
                            { value: "__new__", label: "+ New category…" },
                          ]}
                        />
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
  isProtectedPackage = false,
  requiresPassword = false,
  onCancel,
  onSubmit,
}: {
  path: string;
  isProtectedPackage?: boolean;
  /** A bare, in-place `.db` that's encrypted (its `.key` sits beside it) — unlike a `.vaultspend`
   * package, nothing is copied, but a password is still needed to open it. Lets a profile removed
   * from the list ("forgot the password? remove it" or a plain Delete) be re-added with the correct
   * password or recovery key, matching what the lock screen's own wording already promises. */
  requiresPassword?: boolean;
  onCancel: () => void;
  onSubmit: (name: string, password?: string) => void | Promise<void>;
}) {
  const needsPassword = isProtectedPackage || requiresPassword;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || (needsPassword && !password)) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(name.trim(), needsPassword ? password : undefined);
    } catch (e) {
      setError(errorMessage(e));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={isProtectedPackage ? "Import a protected profile" : "Use an existing data file"} onCancel={onCancel}>
      <p className="modal-message-secondary" style={{ userSelect: "text", wordBreak: "break-all" }}>
        {path}
      </p>
      <p className="modal-message modal-message-secondary">
        {isProtectedPackage
          ? "The encrypted database and its protection information will be verified, then copied into Vault Spend as a new profile. The package stays unchanged."
          : "Vault Spend will start using this file right away, registered as a new profile you can switch away from anytime. The file stays exactly where it is — nothing is copied or moved."}
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
        {needsPassword && (
          <label className="modal-field">
            <span>{isProtectedPackage ? "Package password" : "Password"}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <p className="launch-error-problem" role="alert">{error}</p>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim() || (needsPassword && !password)}>
            {isProtectedPackage ? "Import profile" : "Use this file"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function ChooseExistingDataSourceDialog({
  onCancel,
  onDatabase,
  onPackage,
}: {
  onCancel: () => void;
  onDatabase: () => void;
  onPackage: () => void;
}) {
  return (
    <ModalShell title="Add an existing profile" onCancel={onCancel}>
      <p className="modal-message-secondary">Choose what you brought to this computer.</p>
      <div className="choice-card-list">
        <button type="button" className="choice-card" onClick={onDatabase}>
          <strong>Database file</strong>
          <span>An unprotected Vault Spend .db file</span>
        </button>
        <button type="button" className="choice-card" onClick={onPackage}>
          <strong>Protected package</strong>
          <span>A password-protected .vaultspend package folder</span>
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </ModalShell>
  );
}

/** `suggestion` (see `importSignSuggestion`) preselects an answer — the primary, focused button — and says
 * why; with none, Flip stays the primary button as it always was. Either answer can still be chosen. */
export function ConfirmInvertDialog({
  onCancel,
  onConfirm,
  accountName,
  suggestion,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  accountName?: string;
  suggestion?: ImportSignSuggestion;
}) {
  const flip = suggestion?.flip ?? null;
  const hint =
    suggestion?.reason === "remembered"
      ? `Last import into ${accountName}: ${flip ? "flipped the signs" : "kept as-is"}.`
      : suggestion?.reason === "credit-positive"
        ? "Most amounts in this file are positive. For a credit card that usually means charges are shown as positive."
        : null;
  const keepIsPrimary = flip === false;
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
      {hint && (
        <p className="modal-message" data-import-sign-hint>
          {hint}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className={keepIsPrimary ? undefined : "modal-secondary"} onClick={onCancel} autoFocus={flip === false}>
          Keep as-is
        </button>
        <button type="button" className={keepIsPrimary ? "modal-secondary" : undefined} onClick={onConfirm} autoFocus={flip === true}>
          Flip the signs
        </button>
      </div>
    </ModalShell>
  );
}

/** Shown before a CSV export completes, but only when the active profile is
 * password protected — a plain export never asks. CSV has no encryption of
 * its own, so an exported file carries the same data in the clear next to
 * an encrypted database; this is the one place that fact needs saying, per
 * plan v2 §4.11's exact wording. */
export function CsvExportWarningDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Export as CSV?" onCancel={onCancel}>
      <p className="modal-message">
        CSV files are not password protected. Anyone who can open the exported file can read this data.
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm}>
          Export anyway
        </button>
      </div>
    </ModalShell>
  );
}

/** Switching to a password-protected profile from inside the running app (Phase C, Task 7, decision
 * 4) — asks for its password instead of calling the plain `switch_profile` command, which has no
 * way to unlock anything. Wraps the same `PasswordForm` `ProfileLockScreen` uses, so a wrong
 * password behaves identically in both places. Nothing about the currently open profile is touched
 * unless `onSubmit` itself succeeds — a rejected `onSubmit` leaves this dialog open with the error
 * inline, same as any other failed attempt. */
export function SwitchToProtectedProfileDialog({
  profileName,
  onCancel,
  onSubmit,
}: {
  profileName: string;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  return (
    <ModalShell title={`${profileName} is password protected`} onCancel={onCancel}>
      <PasswordForm submitLabel="Switch" onSubmit={onSubmit} onCancel={onCancel} />
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
          <MenuSelect
            ariaLabel={`Choose ${label}`}
            placeholder="Choose…"
            value={selectedKey}
            onChange={setSelectedKey}
            options={options.map((o) => ({ value: getKey(o), label: getLabel(o) }))}
          />
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
  safeToSpendEnabled,
  onAdd,
  onCancel,
}: {
  currentWidgets: WidgetId[];
  accounts: Account[];
  buckets: Bucket[];
  holdings: Holding[];
  safeToSpendEnabled: boolean;
  onAdd: (id: WidgetId) => void;
  onCancel: () => void;
}) {
  const groups: { title: string; items: typeof WIDGET_CATALOG }[] = [
    { title: "Core widgets", items: WIDGET_CATALOG.filter((w) => w.group === "core" && (safeToSpendEnabled || w.id !== "safe_to_spend")) },
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
 * ticked; unticking one leaves it as ordinary spending/income for Link, and
 * for Dismiss selected. Dismiss (selected, or all) tells Vault
 * Spend to stop suggesting a pair — it's a decision about the *suggestion*,
 * never the transactions themselves: nothing is deleted, no category or
 * amount changes, and totals are untouched. Not now just closes for this
 * session; a dismissed pair won't come back even after restart. */
export function TransferReviewDialog({
  pairs,
  onLink,
  onDismiss,
  onDismissAll,
  onCancel,
}: {
  pairs: { out: Transaction; in: Transaction }[];
  onLink: (pairs: { out_id: number; in_id: number }[]) => void;
  /** Dismiss one or more exact pairs — never treats an unchecked pair as
   * included. Rejecting means the dialog stays open with an inline error;
   * resolving means the caller has already refreshed `pairs` for the next render. */
  onDismiss: (pairs: { out_id: number; in_id: number }[]) => Promise<void>;
  /** Dismisses the *complete* current eligible set, including alternate
   * pairings this dialog's own one-per-transaction view doesn't show — the
   * caller fetches that full set itself so "Dismiss all" really clears the list. */
  onDismissAll: () => Promise<void>;
  onCancel: () => void;
}) {
  // Keyed by the *pair* (both legs), not just the out id: if dismissing one
  // alternate surfaces another with the same out transaction but a
  // different in leg, that's a different pair the user hasn't reviewed —
  // keying by out id alone let it silently inherit whatever the old pair's
  // checkbox happened to say (found by code review). A pair not in this
  // set (new, or never explicitly toggled) reads as unchecked.
  const pairKey = (p: { out: Transaction; in: Transaction }) => `${p.out.id}:${p.in.id}`;
  const [checked, setChecked] = useState<Set<string>>(() => new Set(pairs.map(pairKey)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chosen = pairs.filter((p) => checked.has(pairKey(p)));

  async function runDismiss(action: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (pairs.length === 0) {
    return (
      <ModalShell title="Possible transfers" onCancel={onCancel} wide>
        <p className="modal-message modal-message-secondary">No more possible transfers to review right now.</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Possible transfers" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        These look like money moving between your own accounts. Linking a pair keeps both sides out of your income and
        spending totals, and shows them as one row in Transactions. Dismissing a pair just stops Vault Spend suggesting
        it again — it never changes the transactions themselves. You can unlink or manually link any time.
      </p>
      {error && (
        <p className="launch-error-problem" role="alert">
          {error}
        </p>
      )}
      <ul className="transfer-review-list">
        {pairs.map((p) => {
          const days = Math.abs(Math.round((Date.parse(p.out.date) - Date.parse(p.in.date)) / 86_400_000));
          return (
            <li key={p.out.id}>
              <label className="transfer-review-row">
                <input type="checkbox" checked={checked.has(pairKey(p))} onChange={() => toggle(pairKey(p))} />
                <span className="transfer-review-when">{p.out.date}</span>
                <span className="transfer-review-what">
                  {p.out.account_name} → {p.in.account_name}
                </span>
                <span className="transfer-review-amount">{formatAmount(p.in.amount)}</span>
                <span className="transfer-review-note">{days === 0 ? "same day" : `${days} day${days === 1 ? "" : "s"} apart`}</span>
              </label>
              <details className="transfer-review-details">
                <summary>View transactions</summary>
                <div className="transfer-review-transactions">
                  {[{ transaction: p.out, direction: "Money out" }, { transaction: p.in, direction: "Money in" }].map(({ transaction, direction }) => (
                    <div className="transfer-review-transaction" key={transaction.id}>
                      <strong>{direction} · {transaction.account_name}</strong>
                      <span>{transaction.date} · {formatAmount(transaction.amount)}</span>
                      <span>{transaction.description}</span>
                      <span className="transfer-review-note">Category: {transaction.category || "Uncategorized"}</span>
                    </div>
                  ))}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel} disabled={saving}>
          Not now
        </button>
        <button
          type="button"
          className="modal-secondary"
          data-dismiss-selected
          disabled={saving || chosen.length === 0}
          onClick={() => runDismiss(() => onDismiss(chosen.map((p) => ({ out_id: p.out.id, in_id: p.in.id }))))}
        >
          Dismiss {chosen.length > 0 ? chosen.length : ""} selected
        </button>
        <button type="button" className="modal-secondary" data-dismiss-all disabled={saving} onClick={() => runDismiss(onDismissAll)}>
          Dismiss all
        </button>
        <button
          type="button"
          disabled={saving || chosen.length === 0}
          onClick={() => onLink(chosen.map((p) => ({ out_id: p.out.id, in_id: p.in.id })))}
        >
          Link {chosen.length} as {chosen.length === 1 ? "a transfer" : "transfers"}
        </button>
      </div>
    </ModalShell>
  );
}

/** The review report for automatic transfer links (Settings > "Link matching
 * transfers automatically"): every pair Vault Spend linked on its own that
 * nobody has confirmed yet. "Looks right" clears a pair from this list (the link
 * stays); "Unlink" undoes it, and that pair is never auto-linked again. */
export function AutoLinkedReviewDialog({
  pairs,
  onUnlink,
  onLooksRight,
  onClose,
}: {
  pairs: { out: Transaction; in: Transaction }[];
  onUnlink: (outId: number) => void;
  onLooksRight: (outIds: number[]) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title="Auto-linked transfers" onCancel={onClose} wide>
      <p className="modal-message modal-message-secondary">
        Vault Spend linked these pairs on its own: each was the only possible match for the other. They no longer count as
        income or spending. Mark a pair “Looks right” to clear it from this list, or Unlink it if it isn't really a transfer
        (it won't be linked automatically again).
      </p>
      {pairs.length === 0 ? (
        <p className="empty-state" data-autolink-empty>
          Nothing left to review.
        </p>
      ) : (
        <ul className="transfer-review-list" data-autolink-list>
          {pairs.map((p) => (
            <li key={p.out.id}>
              <div className="autolink-review-row" data-autolink-row={p.out.id}>
                <span className="transfer-review-when">{p.out.date}</span>
                <span className="transfer-review-what">
                  {p.out.account_name} → {p.in.account_name}
                </span>
                <span className="transfer-review-amount">{formatAmount(p.in.amount)}</span>
                <span className="autolink-review-actions">
                  <button type="button" className="modal-secondary btn-sm" data-autolink-unlink onClick={() => onUnlink(p.out.id)}>
                    Unlink
                  </button>
                  <button type="button" className="modal-secondary btn-sm" data-autolink-ok onClick={() => onLooksRight([p.out.id])}>
                    Looks right
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onClose}>
          Close
        </button>
        {pairs.length > 1 && (
          <button type="button" data-autolink-ok-all onClick={() => onLooksRight(pairs.map((p) => p.out.id))}>
            Looks right — all {pairs.length}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
