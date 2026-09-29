import { useEffect, useId } from "react";
import { usePopover } from "./usePopover";

/** A row-level single-select — the account/member/category editor for one
 * ledger row — replacing a native `<select>`. A native select's closed-state
 * box always clips its selected text to whatever width it's given, in every
 * engine; there is no CSS that makes it wrap instead. This wraps, so a long
 * account or category name (the reproduced defect) is fully readable rather
 * than cut off at a fixed pixel width. Same `usePopover` menu/keyboard
 * pattern as `CategoryFilterDropdown` and `AccountDestinationDropdown`. */
export function RowFieldDropdown({
  options,
  value,
  ariaLabel,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover();
  const menuId = useId();
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const panel = rootRef.current;
    (panel?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? panel?.querySelector<HTMLButtonElement>('[role="menuitemradio"]'))?.focus();
  }, [open, rootRef]);

  function choose(next: string) {
    setOpen(false);
    triggerRef.current?.focus();
    onChange(next);
  }

  return (
    <div
      className="account-filter row-field"
      ref={rootRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="account-filter-toggle row-field-toggle"
        aria-label={ariaLabel}
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
        <span>{selectedLabel}</span>
        <span className="account-filter-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          className="account-filter-panel row-field-panel"
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={(e) => {
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
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
              className="account-destination-option"
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              <span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
