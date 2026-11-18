import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** A page's section tabs (Reports, Cash Flow, Investments). Each panel mounts the first time it is
 * opened and then stays mounted (hidden), so it keeps its own state while another tab is showing.
 * Selection is local unless the parent supplies selected/onSelect. A remount starts fresh.
 * Tabs are `${idPrefix}-tab-${id}`, panels `${idPrefix}-panel-${id}`, and each tab carries
 * `data-${idPrefix}-tab` for tests. */
export function PageTabs<T extends string>({
  tabs,
  initial,
  selected,
  onSelect,
  idPrefix,
  label,
  className,
  panelClassName,
  render,
}: {
  tabs: { id: T; label: string }[];
  initial: T;
  selected?: T;
  onSelect?: (id: T) => void;
  idPrefix: string;
  /** The tablist's accessible name, e.g. "Report sections". */
  label: string;
  /** Extra classes on the tablist, after the shared `view-toggle`. */
  className?: string;
  panelClassName?: string;
  /** A panel's content; `active` is whether it is the one showing. */
  render: (id: T, active: boolean) => ReactNode;
}) {
  const [localTab, setTab] = useState<T>(initial);
  const tab = selected ?? localTab;
  const [shown, setShown] = useState<Set<T>>(() => new Set([tab]));
  if (!shown.has(tab)) setShown(new Set(shown).add(tab));
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  function select(next: T, moveFocus: boolean) {
    if (selected === undefined) setTab(next);
    onSelect?.(next);
    if (moveFocus) tabRefs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + last) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    select(tabs[target].id, true);
  }

  return (
    <>
      <div className={className ? `view-toggle ${className}` : "view-toggle"} role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "view-toggle-active" : ""}
            {...{ [`data-${idPrefix}-tab`]: t.id }}
            onClick={() => select(t.id, false)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${idPrefix}-panel-${t.id}`}
          aria-labelledby={`${idPrefix}-tab-${t.id}`}
          hidden={tab !== t.id}
          className={panelClassName}
        >
          {shown.has(t.id) && render(t.id, tab === t.id)}
        </div>
      ))}
    </>
  );
}
