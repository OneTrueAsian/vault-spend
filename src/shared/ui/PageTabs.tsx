import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** A page's section tabs (Reports, Cash Flow, Investments). Each panel mounts the first time it is
 * opened and then stays mounted (hidden), so it keeps its own state while another tab is showing.
 * The selected tab lives only here, so a profile switch (which remounts the app) starts fresh.
 * Tabs are `${idPrefix}-tab-${id}`, panels `${idPrefix}-panel-${id}`, and each tab carries
 * `data-${idPrefix}-tab` for tests. */
export function PageTabs<T extends string>({
  tabs,
  initial,
  idPrefix,
  label,
  className,
  panelClassName,
  render,
}: {
  tabs: { id: T; label: string }[];
  initial: T;
  idPrefix: string;
  /** The tablist's accessible name, e.g. "Report sections". */
  label: string;
  /** Extra classes on the tablist, after the shared `view-toggle`. */
  className?: string;
  panelClassName?: string;
  /** A panel's content; `active` is whether it is the one showing. */
  render: (id: T, active: boolean) => ReactNode;
}) {
  const [tab, setTab] = useState<T>(initial);
  const [shown, setShown] = useState<Set<T>>(() => new Set([initial]));
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  function select(next: T, moveFocus: boolean) {
    setTab(next);
    setShown((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
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
