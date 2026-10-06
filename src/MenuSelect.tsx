import "./MenuSelect.css";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface MenuSelectOption {
  value: string;
  label: string;
  /** Shown but not choosable, like a native <option disabled> (e.g. "Custom (unsaved)"). */
  disabled?: boolean;
  /** A heading shown above the first option of each run with the same group, like <optgroup label>. */
  group?: string;
}

/** A single-select popover menu, matching the pattern the account/member/category filters use. It
 * replaces a native <select> so the open list looks like the rest of the app's menus (the OS draws a
 * native list and the themes cannot style it). The caller supplies the option list and treats every
 * option the same way; this component invents no sentinel of its own.
 *
 * The menu is a top-layer popover, so a dialog, a scrolling table or a `backdrop-filter` ancestor
 * cannot clip it, while its DOM stays inside the trigger's own container (and so inside a dialog's
 * focus trap). The trigger carries `data-value` so a test or caller can read the current value the
 * way it would a <select>'s `.value`.
 *
 * `value` that matches no option shows `placeholder` when it is "" (the "Set category to…" action
 * menus, which reset to "" after each pick) and otherwise the raw value. */
export function MenuSelect({
  options,
  value,
  onChange,
  ariaLabel,
  menuLabel = ariaLabel,
  placeholder,
  disabled = false,
  fill = false,
  showName = false,
  title,
  triggerClassName = "",
  panelClassName = "",
  triggerAttrs,
}: {
  options: MenuSelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** The control's name; the trigger reads "<ariaLabel>: <selected label>". */
  ariaLabel: string;
  menuLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Stretch to the width of the container, the way a native select does in a form field. */
  fill?: boolean;
  /** Also show the name on the trigger, so it reads "<ariaLabel>: <selected label> ▾" (the Dashboard's
   * "Layout: Default"), for a menu with no visible label beside it. */
  showName?: boolean;
  title?: string;
  triggerClassName?: string;
  panelClassName?: string;
  /** Extra attributes for the trigger, e.g. `data-*` hooks that tests and styles rely on. */
  triggerAttrs?: Record<string, string | number | boolean | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const match = options.find((o) => o.value === value);
  const showingPlaceholder = !match && value === "" && placeholder !== undefined;
  const selectedLabel = match?.label ?? (value === "" ? (placeholder ?? "") : value);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRef.current) return;
    const panel = panelRef.current;
    panel.showPopover?.();
    // Lines the menu up under (or over) the trigger. Runs again on scroll and resize so a page that scrolls
    // after the menu opens (a click scrolling the trigger into view, say) carries the menu with it.
    function place() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 280 && above > below;
      const height = Math.min(300, Math.max(0, up ? above : below));
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24);
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      panel.style.top = `${up ? rect.top - Math.min(panel.scrollHeight, height) - 6 : rect.bottom + 6}px`;
    }
    place();
    (panel.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)') ?? panel.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onScroll(event: Event) {
      if (!panel.contains(event.target as Node)) place();
    }
    const onResize = () => place();
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      panel.hidePopover?.();
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function choose(next: string) {
    close(true);
    onChange(next);
  }

  let lastGroup: string | undefined;
  return (
    <div
      className={`menu-select${fill ? " menu-select-fill" : ""}`}
      ref={rootRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`account-filter-toggle menu-select-toggle${showingPlaceholder ? " menu-select-placeholder" : ""} ${triggerClassName}`.trim()}
        title={title ?? selectedLabel}
        aria-label={showingPlaceholder ? ariaLabel : `${ariaLabel}: ${selectedLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-value={value}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        {...triggerAttrs}
      >
        <span>{showName && !showingPlaceholder ? `${ariaLabel}: ${selectedLabel}` : selectedLabel}</span>
        <span className="account-filter-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          popover="manual"
          role="menu"
          aria-label={menuLabel}
          className={`menu-select-panel ${panelClassName}`.trim()}
          onKeyDown={(e) => {
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : e.key === "ArrowDown"
                    ? (index + 1) % buttons.length
                    : e.key === "ArrowUp"
                      ? (index - 1 + buttons.length) % buttons.length
                      : -1;
            if (e.key.length === 1 && /\S/.test(e.key)) {
              const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
              const found = ordered.find((button) => button.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
              if (found) next = buttons.indexOf(found);
            }
            if (next >= 0) {
              e.preventDefault();
              e.stopPropagation();
              buttons[next]?.focus();
            }
          }}
        >
          {options.map((option) => {
            const heading = option.group !== undefined && option.group !== lastGroup ? option.group : null;
            lastGroup = option.group;
            return (
              <div key={option.value} role="presentation" className="menu-select-entry">
                {heading !== null && <div className="menu-select-group">{heading}</div>}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === value}
                  data-value={option.value}
                  disabled={option.disabled}
                  className="account-destination-option"
                  // Keep focus inside the menu until click selects the option. Safari
                  // can blur mouse-clicked buttons before click, closing the popover.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.value)}
                >
                  <span>{option.label}</span>
                  <span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
