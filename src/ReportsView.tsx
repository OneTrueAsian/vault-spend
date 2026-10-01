import { useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { ReportsOverview } from "./ReportsOverview";
import { ComparisonsView } from "./comparisons/ComparisonsView";

type ReportsTab = "overview" | "comparisons";

const TABS: { id: ReportsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "comparisons", label: "Comparisons" },
];

type OverviewProps = ComponentProps<typeof ReportsOverview>;

/** Reports: the familiar report page under "Overview" and age-based financial comparisons under
 * "Comparisons". Each panel mounts the first time it is opened and then stays mounted (hidden), so
 * Overview keeps its date range and loaded data while someone looks at Comparisons. The selected
 * tab lives only in this component, so a profile switch (which remounts the app) starts fresh. */
export function ReportsView({ initialTab = "overview", ...overviewProps }: OverviewProps & { initialTab?: ReportsTab }) {
  const [tab, setTab] = useState<ReportsTab>(initialTab);
  // A panel is rendered once it has been shown; opening Comparisons directly never loads Overview.
  const [shown, setShown] = useState<Set<ReportsTab>>(() => new Set([initialTab]));
  const tabRefs = useRef<Partial<Record<ReportsTab, HTMLButtonElement | null>>>({});

  function select(next: ReportsTab, moveFocus: boolean) {
    setTab(next);
    setShown((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    if (moveFocus) tabRefs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    const target =
      event.key === "ArrowRight" ? (index + 1) % TABS.length
      : event.key === "ArrowLeft" ? (index + last) % TABS.length
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    select(TABS[target].id, true);
  }

  return (
    <div className="reports-view reports-shell">
      <div className="page-top no-print">
        <h1 className="view-title">Reports</h1>
      </div>

      <div className="view-toggle reports-tabs no-print" role="tablist" aria-label="Report sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`reports-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`reports-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "view-toggle-active" : ""}
            data-reports-tab={t.id}
            onClick={() => select(t.id, false)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`reports-panel-${t.id}`}
          aria-labelledby={`reports-tab-${t.id}`}
          hidden={tab !== t.id}
          className="reports-panel"
        >
          {shown.has(t.id) &&
            (t.id === "overview" ? (
              <ReportsOverview {...overviewProps} />
            ) : (
              <ComparisonsView
                active={tab === "comparisons"}
                accounts={overviewProps.accounts}
                transactions={overviewProps.transactions}
                assets={overviewProps.assets}
                familyMembers={overviewProps.familyMembers}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
