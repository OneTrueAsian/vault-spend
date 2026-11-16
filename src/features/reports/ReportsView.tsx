import { type ComponentProps } from "react";
import { PageTabs } from "../../shared/ui/PageTabs";
import { ReportsOverview } from "./ReportsOverview";
import { ComparisonsView } from "../comparisons/ComparisonsView";
import { HelpLink } from "../../shared/ui/HelpLink";
import type { Tab } from "../../shared/native/appTypes";

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
export function ReportsView({
  initialTab = "overview",
  onOpenHelp,
  ...overviewProps
}: OverviewProps & {
  initialTab?: ReportsTab;
  /** Opens Help at this page's section (the ? beside the title). */
  onOpenHelp?: (tab: Tab) => void;
}) {
  return (
    <div className="reports-view reports-shell">
      <div className="page-top no-print">
        <div className="view-title-row">
          <h1 className="view-title">Reports</h1>
          {onOpenHelp && <HelpLink tab="reports" onOpen={onOpenHelp} />}
        </div>
      </div>

      <PageTabs
        tabs={TABS}
        initial={initialTab}
        idPrefix="reports"
        label="Report sections"
        className="reports-tabs no-print"
        panelClassName="reports-panel"
        render={(id, active) =>
          id === "overview" ? (
            <ReportsOverview {...overviewProps} />
          ) : (
            <ComparisonsView
              active={active}
              accounts={overviewProps.accounts}
              transactions={overviewProps.transactions}
              assets={overviewProps.assets}
              familyMembers={overviewProps.familyMembers}
            />
          )
        }
      />
    </div>
  );
}
