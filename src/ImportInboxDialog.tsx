import { useEffect, useRef, useState } from "react";
import { ModalShell } from "./Modal";
import { formatAmount } from "./format";
import type { InboxItem } from "./importInbox";

const REASON_LABELS = { uncategorized: "No category", low_confidence: "Unsure", duplicate: "Possible duplicate", large: "Unusually large" } as const;

/** A keyboard-driven pass over the transactions that need a human look —
 * after an import, or any time from Transactions. ↑/↓ (or k/j) move, Enter
 * accepts the shown category (or confirms the row is fine), E jumps to the
 * category list, X deletes a duplicate, S skips. The list is fixed when the
 * dialog opens, so finishing a row never shuffles the ones below it. */
export function ImportInboxDialog({
  items,
  categories,
  onSetCategory,
  onDelete,
  onDismiss,
  onClose,
}: {
  items: InboxItem[];
  categories: string[];
  onSetCategory: (id: number, category: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  /** "Looks right": stop flagging this transaction as `large` / `duplicate`. */
  onDismiss: (id: number, kinds: ("large" | "duplicate")[]) => Promise<void>;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const [resolved, setResolved] = useState<Map<number, string>>(new Map());
  const [choices, setChoices] = useState<Map<number, string>>(
    () => new Map(items.map((i) => [i.transaction.id, i.suggestion?.category ?? i.transaction.category ?? ""])),
  );
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const remaining = items.filter((i) => !resolved.has(i.transaction.id)).length;

  useEffect(() => {
    const id = items[active]?.transaction.id;
    if (id !== undefined) rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  function finish(id: number, label: string) {
    setResolved((prev) => new Map(prev).set(id, label));
    // Move on to the next row that still needs an answer.
    const from = items.findIndex((i) => i.transaction.id === id);
    const nextIndex = items.findIndex((i, idx) => idx > from && !resolved.has(i.transaction.id));
    if (nextIndex >= 0) setActive(nextIndex);
  }

  async function accept(item: InboxItem) {
    const choice = choices.get(item.transaction.id) ?? "";
    if (!choice) return;
    await onSetCategory(item.transaction.id, choice);
    finish(item.transaction.id, `Set to ${choice}`);
  }

  async function keep(item: InboxItem) {
    const kinds = item.reasons.flatMap((r) => (r.kind === "large" || r.kind === "duplicate" ? [r.kind] : []));
    if (kinds.length > 0) await onDismiss(item.transaction.id, kinds);
    finish(item.transaction.id, "Kept");
  }

  async function remove(item: InboxItem) {
    await onDelete(item.transaction.id);
    finish(item.transaction.id, "Deleted");
  }

  function needsCategory(item: InboxItem) {
    return item.reasons.some((r) => r.kind === "uncategorized" || r.kind === "low_confidence");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "SELECT" || target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const item = items[active];
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (!item || resolved.has(item.transaction.id)) {
      return;
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (needsCategory(item)) void accept(item);
      else void keep(item);
    } else if (e.key === "s") {
      e.preventDefault();
      finish(item.transaction.id, "Skipped");
    } else if (e.key === "x" && item.reasons.some((r) => r.kind === "duplicate")) {
      e.preventDefault();
      void remove(item);
    } else if (e.key === "e" && needsCategory(item)) {
      e.preventDefault();
      rowRefs.current.get(item.transaction.id)?.querySelector("select")?.focus();
    }
  }

  return (
    <ModalShell title="Review transactions" onCancel={onClose} wide>
      <p className="modal-message modal-message-secondary" data-inbox-summary>
        {items.length === 0
          ? "Nothing needs a look."
          : remaining === 0
            ? `All ${items.length} reviewed.`
            : `${remaining} of ${items.length} still to review.`}{" "}
        <span className="inbox-keys">↑↓ move · Enter accept · E category · X delete duplicate · S skip</span>
      </p>
      <div className="inbox-list" tabIndex={0} onKeyDown={handleKeyDown} data-inbox-list>
        {items.map((item, index) => {
          const t = item.transaction;
          const done = resolved.get(t.id);
          const cls = ["inbox-row", index === active ? "inbox-row-active" : "", done ? "inbox-row-done" : ""].filter(Boolean).join(" ");
          return (
            <div
              key={t.id}
              ref={(el) => {
                if (el) rowRefs.current.set(t.id, el);
              }}
              className={cls}
              data-inbox-row={t.id}
              data-inbox-state={done ? "done" : "open"}
              data-inbox-active={index === active ? "true" : undefined}
              onClick={() => setActive(index)}
            >
              <div className="inbox-main">
                <span className="inbox-date">{t.date}</span>
                <span className="inbox-desc">{t.description}</span>
                <span className="inbox-account">{t.account_name}</span>
                <span className="inbox-amount">{formatAmount(t.amount)}</span>
              </div>
              <div className="inbox-reasons">
                {item.reasons.map((r, i) => (
                  <span key={i} className={`inbox-reason inbox-reason-${r.kind}`} title={r.detail}>
                    {REASON_LABELS[r.kind]}
                    {r.kind !== "uncategorized" && <span className="inbox-reason-detail"> — {r.detail}</span>}
                  </span>
                ))}
                {item.suggestion && (
                  <span className="inbox-suggestion" data-inbox-suggestion>
                    Suggested: {item.suggestion.category} ({item.suggestion.support} similar)
                  </span>
                )}
              </div>
              {done ? (
                <div className="inbox-done" data-inbox-done>
                  {done}
                </div>
              ) : (
                <div className="inbox-actions">
                  {needsCategory(item) && (
                    <>
                      <select
                        aria-label={`Category for ${t.description}`}
                        value={choices.get(t.id) ?? ""}
                        onChange={(e) => setChoices((prev) => new Map(prev).set(t.id, e.target.value))}
                      >
                        <option value="">Choose a category…</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <button type="button" disabled={!(choices.get(t.id) ?? "")} onClick={() => void accept(item)} data-inbox-accept>
                        Use {choices.get(t.id) || "category"}
                      </button>
                    </>
                  )}
                  {item.reasons.some((r) => r.kind === "duplicate") && (
                    <button type="button" className="btn-danger" onClick={() => void remove(item)} data-inbox-delete>
                      Delete duplicate
                    </button>
                  )}
                  {!needsCategory(item) && (
                    <button type="button" className="modal-secondary" onClick={() => void keep(item)} data-inbox-keep>
                      {item.reasons.some((r) => r.kind === "duplicate") ? "Keep it" : "Looks right"}
                    </button>
                  )}
                  <button type="button" className="modal-secondary" onClick={() => finish(t.id, "Skipped")} data-inbox-skip>
                    Skip
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose} data-inbox-close>
          {remaining === 0 ? "Done" : "Close"}
        </button>
      </div>
    </ModalShell>
  );
}
