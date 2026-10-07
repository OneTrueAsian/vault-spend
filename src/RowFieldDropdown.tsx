import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "./useDismiss";
import { useFixedPanel } from "./useFixedPanel";

/** A row-level single-select — the account/member/category editor for one
 * ledger row — replacing a native `<select>`. A native select's closed-state
 * box always clips its selected text to whatever width it's given, in every
 * engine; there is no CSS that makes it wrap instead. This wraps, so a long
 * account or category name (the reproduced defect) is fully readable rather
 * than cut off at a fixed pixel width.
 *
 * Does not use the shared `usePopover` hook: a row lives inside the ledger's
 * scrolling container (`.ledger-table-scroll { overflow-x: auto }`, which
 * per the CSS spec also clips vertically once either axis is non-visible —
 * confirmed against the real compiled app, a menu opened on the last visible
 * row was clipped ~130px short). `usePopover`'s own panel is positioned
 * `absolute` against its trigger, inheriting whatever ancestor clips it;
 * this one is portaled to `document.body` and positioned `fixed` from the
 * trigger's own `getBoundingClientRect()`, the same technique `Modal.tsx`'s
 * `ModalShell` already uses to escape the Transparent theme's
 * `backdrop-filter` containing block. */
export function RowFieldDropdown({
  options,
  value,
  ariaLabel,
  onChange,
  variant = "boxed",
  displayLabel,
  triggerClassName,
}: {
  /** `disabled` marks a placeholder that describes the current "nothing
   * chosen" state without itself being a choosable value — mirroring a
   * native `<select>`'s `<option disabled>` placeholder, which can never
   * be selected either (picking it would otherwise write that empty
   * value back through onChange as a real, saved choice). */
  options: { value: string; label: string; disabled?: boolean }[];
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  /** "plain" reads as ordinary table text (no box; the caret shows on hover, focus or while open). */
  variant?: "boxed" | "plain";
  /** Overrides the trigger's text, e.g. "" so a row with no family member shows a blank cell. */
  displayLabel?: string;
  /** Extra class on the trigger, e.g. `row-field-needs` for a "needs you" state. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;
  const shownLabel = displayLabel ?? selectedLabel;

  useDismiss(open, [rootRef, panelRef], (reason) => {
    setOpen(false);
    if (reason === "escape") triggerRef.current?.focus();
  });

  useFixedPanel(open, triggerRef, panelRef);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    (panel.querySelector<HTMLButtonElement>('[aria-checked="true"]:not([aria-disabled="true"])') ??
      panel.querySelector<HTMLButtonElement>('[role="menuitemradio"]:not([aria-disabled="true"])'))?.focus();
  }, [open]);

  function choose(next: string) {
    if (next === value) return;
    setOpen(false);
    triggerRef.current?.focus();
    onChange(next);
  }

  return (
    <div className="account-filter row-field" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={["account-filter-toggle row-field-toggle", variant === "plain" ? "row-field-toggle-plain" : "", triggerClassName ?? ""].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
        // The ledger clips a long label with an ellipsis; this keeps the full name readable on hover.
        title={selectedLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {shownLabel !== "" && <span>{shownLabel}</span>}
        <span className="account-filter-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            className="account-filter-panel row-field-panel row-field-panel-fixed"
            role="menu"
            aria-label={ariaLabel}
            onKeyDown={(e) => {
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([aria-disabled='true'])"));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : e.key === "ArrowDown"
                      ? (index + 1) % buttons.length
                      : e.key === "ArrowUp"
                        ? (index - 1 + buttons.length) % buttons.length
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                buttons[next]?.focus();
              }
            }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                aria-disabled={option.disabled ? "true" : undefined}
                className="account-destination-option"
                onClick={() => {
                  if (!option.disabled) choose(option.value);
                }}
              >
                <span>{option.label}</span>
                <span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
