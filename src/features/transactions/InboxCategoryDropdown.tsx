import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** The top layer keeps row menus clear of the inbox's scrolling container,
 * while their DOM remains inside the dialog's existing focus trap. */
export function InboxCategoryDropdown({ categories, value, placeholder, label, disabled, onChange }: {
  categories: string[];
  value: string;
  placeholder: string;
  label: string;
  disabled: boolean;
  onChange: (category: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRef.current) return;
    const panel = panelRef.current;
    panel.showPopover();
    const rect = triggerRef.current.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 280 && above > below;
    const height = Math.min(280, Math.max(0, up ? above : below));
    const width = Math.min(Math.max(rect.width, 220), innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${height}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    panel.style.top = `${up ? rect.top - Math.min(panel.scrollHeight, height) - 6 : rect.bottom + 6}px`;
    (panel.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? panel.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onScroll(event: Event) {
      if (!panel.contains(event.target as Node)) setOpen(false);
    }
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      panel.hidePopover();
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="inbox-category-dropdown" ref={rootRef}
    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}
    onKeyDown={(e) => {
      if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    }}>
    <button type="button" className="account-filter-toggle inbox-category-trigger" ref={triggerRef}
      aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={disabled} onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}>
      <span>{value || placeholder}</span><span className="account-filter-caret" aria-hidden="true">▾</span>
    </button>
    {open && <div ref={panelRef} id={id} popover="manual" role="menu" aria-label={label} className="inbox-category-menu"
      onKeyDown={(e) => {
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 :
          e.key === "ArrowDown" ? (index + 1) % buttons.length : e.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : -1;
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
          const match = ordered.find((button) => button.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
          if (match) next = buttons.indexOf(match);
        }
        if (next >= 0) { e.preventDefault(); e.stopPropagation(); buttons[next]?.focus(); }
      }}>
      {categories.map((category) => <button type="button" role="menuitemradio" aria-checked={value === category}
        className="account-destination-option" key={category} onClick={() => { close(true); onChange(category); }}>
        <span>{category}</span><span aria-hidden="true">{value === category ? "✓" : ""}</span>
      </button>)}
    </div>}
  </div>;
}
