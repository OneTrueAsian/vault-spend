import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "./useDismiss";
import { useFixedPanel } from "./useFixedPanel";
import "./RowMenu.css";

export type RowMenuItem =
  | { kind?: "action"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { kind: "check"; label: string; checked: boolean; onToggle: (next: boolean) => void; disabled?: boolean }
  | { kind: "divider" };

/** The items to show: the truthy ones, minus any divider with nothing before or after it and any
 * divider straight after another. Items switched off for a row leave their dividers behind, and a
 * menu must never start, end or double a line. */
function tidyItems(items: (RowMenuItem | false | null | undefined)[]): RowMenuItem[] {
  const out: RowMenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.kind === "divider" && (out.length === 0 || out[out.length - 1].kind === "divider")) continue;
    out.push(item);
  }
  if (out.length > 0 && out[out.length - 1].kind === "divider") out.pop();
  return out;
}

/** A row's `⋯` actions menu. Portaled to `document.body` and positioned `fixed` (see
 * `useFixedPanel`) so it isn't clipped by the ledger's scroll container. The panel belongs to
 * this component, so if the row unmounts while the menu is open the menu goes with it and
 * nothing runs against the stale row. */
export function RowMenu({ label, items, className }: { label: string; items: (RowMenuItem | false | null | undefined)[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visible = tidyItems(items);

  useDismiss(open, [triggerRef, panelRef], (reason) => {
    setOpen(false);
    if (reason === "escape") triggerRef.current?.focus();
  });

  useFixedPanel(open, triggerRef, panelRef, { minWidth: 200, align: "end" });

  useLayoutEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>("[role^='menuitem']:not([aria-disabled='true'])")?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`row-menu-toggle${className ? ` ${className}` : ""}`}
        data-row-menu=""
        aria-label={label}
        title={label}
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
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            className="row-menu-panel row-field-panel-fixed"
            role="menu"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                close();
                return;
              }
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role^='menuitem']:not([aria-disabled='true'])"));
              if (buttons.length === 0) return;
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              // With nothing focused (index -1), ArrowDown lands on the first item and ArrowUp on the last.
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : e.key === "ArrowDown"
                      ? (index + 1) % buttons.length
                      : e.key === "ArrowUp"
                        ? index < 0
                          ? buttons.length - 1
                          : (index - 1 + buttons.length) % buttons.length
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                buttons[next]?.focus();
              }
            }}
          >
            {visible.map((item, i) => {
              if (item.kind === "divider") return <div key={i} role="separator" className="row-menu-divider" />;
              if (item.kind === "check") {
                return (
                  <button
                    key={i}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={item.checked}
                    aria-disabled={item.disabled ? "true" : undefined}
                    className="row-menu-item"
                    onClick={() => {
                      if (item.disabled) return;
                      close();
                      item.onToggle(!item.checked);
                    }}
                  >
                    {/* The label starts where every other item's does; the tick follows it, drawn by CSS
                        (.row-menu-check-on::before) so the item's text stays just its label. */}
                    <span>{item.label}</span>
                    <span className={`row-menu-check${item.checked ? " row-menu-check-on" : ""}`} aria-hidden="true" />
                  </button>
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  aria-disabled={item.disabled ? "true" : undefined}
                  className={`row-menu-item${item.danger ? " row-menu-item-danger" : ""}`}
                  onClick={() => {
                    if (item.disabled) return;
                    close();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
