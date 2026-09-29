import { useEffect, useId } from "react";
import { usePopover } from "./usePopover";

/** The Transactions toolbar's category filter, matching the popover-menu
 * pattern its account/member/"Add to" siblings already use — same
 * `usePopover` plumbing and `.account-filter-panel` styling
 * (`AccountDestinationDropdown` is the closest sibling: single value,
 * one selection). App.tsx supplies the option list, including the
 * "All categories" and "Uncategorized" sentinels — this component treats
 * every option the same way and invents no sentinel of its own. */
export function CategoryFilterDropdown({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
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
      className="account-filter"
      ref={rootRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="account-filter-toggle category-filter-toggle"
        title={selectedLabel}
        aria-label={`Filter by category: ${selectedLabel}`}
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
          className="account-filter-panel category-filter-panel"
          role="menu"
          aria-label="Filter by category"
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
