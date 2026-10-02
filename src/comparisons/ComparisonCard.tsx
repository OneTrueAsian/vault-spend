import { MenuSelect } from "../MenuSelect";
import type { CardView, MetricId, Universe } from "./types";
import {
  ageGroupLabel,
  barWidths,
  cardNotice,
  cohortLabel,
  differenceText,
  formatWhole,
  metricTitle,
  populationLabel,
  referencePeriodLabel,
  sourceLabel,
  unitSuffix,
} from "./format";

const ICONS: Record<MetricId, string> = {
  spending: "M4 7h16M4 12h16M4 17h10",
  investments: "M4 19V9m6 10V5m6 14v-7m6 7H2",
  income: "M12 3v18m4-14c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 3 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3",
  savings: "M5 11a7 6 0 0 1 14 0v3a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM9 8h.01",
  debt: "M3 7h18v10H3zM3 11h18M7 15h3",
};

function MetricIcon({ metric }: { metric: MetricId }) {
  return (
    <span className="cmp-card-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[metric]} />
      </svg>
    </span>
  );
}

const STATISTIC = { mean: "Average", median: "Middle value" } as const;

/** One comparison. Shows the person's figure, the published peer figure with the population and age
 * group it actually describes, and a difference only when the engine says the comparison is valid.
 * Dollar amounts appear only as text so the app's privacy mask covers them; the bars are hidden by
 * CSS while amounts are hidden. */
export function ComparisonCard({
  view,
  onExplore,
  onChooseUniverse,
  onChooseCohort,
}: {
  view: CardView;
  onExplore: () => void;
  onChooseUniverse: (universe: Universe) => void;
  onChooseCohort: (referenceId: string) => void;
}) {
  const { result, metric } = view;
  const notice = cardNotice(result);
  const adjusted = result.reference;
  // A benchmark gap still shows the person's own total, but only a confirmed one: a total that is
  // partly unassigned or never confirmed (a "$0" for an account nobody was allocated) would mislead.
  const trusted = result.status !== "unavailable" || metric.completeness === "confirmed";
  const shown = trusted ? (result.localValue ?? metric.value) : null;
  const comparing = adjusted !== null && result.dollarDifference !== null;
  const title = metricTitle(result.metric);
  const bars = comparing && shown !== null ? barWidths(shown, adjusted.adjustedValue) : null;
  const holdersOnly = adjusted?.reference.universe === "holders";
  const chosenCohortId = adjusted?.reference.id ?? "";

  return (
    <article className="cmp-card" data-metric={result.metric} data-status={result.status} aria-label={`${title} comparison`}>
      <header className="cmp-card-head">
        <MetricIcon metric={result.metric} />
        <h3>{title}</h3>
        {adjusted && <span className="cmp-kind">{STATISTIC[adjusted.reference.statistic]}</span>}
      </header>

      {shown !== null && (
        <>
          <div className="cmp-value" data-cmp-local>
            {formatWhole(shown)}
            <span className="cmp-unit">{unitSuffix(metric.unit)}</span>
          </div>
          <p className="cmp-measure">
            {metric.origin.kind === "entered" ? "Entered by you" : "From your accounts in Vault Spend"}
            {view.stale && <span className="cmp-stale"> · may be out of date</span>}
          </p>
        </>
      )}

      {notice && (
        <div className={`cmp-notice cmp-notice-${notice.tone}`} role={notice.tone === "warning" ? "status" : undefined} data-cmp-notice>
          <strong>{notice.title}</strong>
          <span>{notice.body}</span>
        </div>
      )}

      {comparing && (
        <>
          <p className="cmp-difference" data-cmp-difference>
            {differenceText(result.dollarDifference ?? "0", result.percentDifference)}
          </p>
          {bars && (
            <div className="cmp-bars" aria-hidden="true">
              <div className="cmp-barline">
                <span>You</span>
                <div className="cmp-track">
                  <div className="cmp-fill" style={{ width: `${bars.you}%` }} />
                </div>
                <span className="cmp-amount">{formatWhole(shown ?? "0")}</span>
              </div>
              <div className="cmp-barline">
                <span>Peers</span>
                <div className="cmp-track">
                  <div className="cmp-fill cmp-fill-peer" style={{ width: `${bars.peer}%` }} />
                </div>
                <span className="cmp-amount">{formatWhole(adjusted.adjustedValue)}</span>
              </div>
            </div>
          )}
          <p className="cmp-reference-line" data-cmp-reference>
            {STATISTIC[adjusted.reference.statistic]} for {adjusted.reference.population}, ages {ageGroupLabel(adjusted.reference.ageMin, adjusted.reference.ageMax)}.
            {" "}
            {referencePeriodLabel(adjusted.reference.period)} figures in {adjusted.adjustedBasisMonth} dollars.
          </p>
          {holdersOnly && <p className="cmp-holders-only" data-cmp-holders-only>Only people who hold this are in the official figure.</p>}
        </>
      )}

      {view.universeOptions.length > 1 && (
        <div className="cmp-choice" role="group" aria-label={`${title}: compare with`}>
          {view.universeOptions.map((u) => (
            <button
              key={u}
              type="button"
              className={adjusted?.reference.universe === u ? "cmp-choice-active" : ""}
              aria-pressed={adjusted?.reference.universe === u}
              data-cmp-universe={u}
              onClick={() => onChooseUniverse(u)}
            >
              {populationLabel(u)}
            </button>
          ))}
        </div>
      )}

      {view.cohortOptions.length > 1 && (
        <div className="cmp-cohort-picker" data-cmp-cohort-picker>
          <MenuSelect
            ariaLabel={`${title}: age group`}
            fill
            placeholder="Choose an age group…"
            value={chosenCohortId && view.cohortOptions.some((o) => o.id === chosenCohortId) ? chosenCohortId : ""}
            options={view.cohortOptions.map((o) => ({ value: o.id, label: cohortLabel(o) }))}
            onChange={onChooseCohort}
          />
        </div>
      )}

      <footer className="cmp-card-foot">
        <span className="cmp-source">{adjusted ? sourceLabel(adjusted.reference.sourceId) : "Household"}</span>
        <button type="button" className="cmp-explore" onClick={onExplore} aria-label={`Explore ${title.toLowerCase()} comparison`}>
          Explore ↗
        </button>
      </footer>
    </article>
  );
}
