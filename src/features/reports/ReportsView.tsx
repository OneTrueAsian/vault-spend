import { type ComponentProps } from "react";
import { ReportsOverview, type ReportsTab } from "./ReportsOverview";
import { ComparisonsView } from "../comparisons/ComparisonsView";
import { HelpLink } from "../../shared/ui/HelpLink";
import type { Tab } from "../../shared/native/appTypes";

type OverviewProps = Omit<ComponentProps<typeof ReportsOverview>, "renderComparisons">;

/** Reports: the report's sections in tabs (Where income went, Categories by month, Daily spending, Tags and people,
 * Savings rate, Year by year) and age-based financial comparisons under "Comparisons". The range, summary and output
 * buttons sit above the tabs and are the hub's (ReportsOverview). Each panel mounts the first time it is opened and then
 * stays mounted (hidden), so a tab keeps its state while someone looks at another. The selected tab lives only in the
 * hub, so a profile switch (which remounts the app) starts fresh. */
export function ReportsView({
  initialTab = "income",
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

      <ReportsOverview
        {...overviewProps}
        initialTab={initialTab}
        renderComparisons={(active) => (
          <ComparisonsView
            active={active}
            accounts={overviewProps.accounts}
            transactions={overviewProps.transactions}
            assets={overviewProps.assets}
            familyMembers={overviewProps.familyMembers}
          />
        )}
      />
    </div>
  );
}
