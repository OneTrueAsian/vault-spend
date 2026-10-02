import { openUrl } from "@tauri-apps/plugin-opener";
import { ModalShell } from "../Modal";
import type { CardView, ExcludeReason } from "./types";
import {
  ageGroupLabel,
  cardNotice,
  differenceText,
  formatWhole,
  metricTitle,
  personLabel,
  populationLabel,
  referencePeriodLabel,
  sourceLabel,
} from "./format";
import { personKey } from "./setupDraft";

const EXCLUDE_TEXT: Record<ExcludeReason, string> = {
  default_type_not_included: "This kind of account does not count here",
  user_excluded: "You left this out",
  not_allocated: "No share of this is yours",
  unclassified: "Needs a comparison type",
};

const CLASS_LABELS: Record<string, string> = {
  retirement: "Retirement accounts",
  taxable: "Taxable investments",
  education: "Education savings",
  other: "Other",
  mortgage: "Mortgage / home loans",
  credit_card: "Credit cards",
  student_loan: "Student loans",
  vehicle: "Vehicle loans",
  unclassified: "No debt type chosen",
};

/** The working behind one card: what makes up your figure, what was left out and why, exactly which
 * published figure it is compared with (population, age group, period, dollar basis, uncertainty,
 * source) and how the difference was calculated. */
export function ComparisonDetailsDialog({
  view,
  members,
  onClose,
}: {
  view: CardView;
  members: { id: number; name: string }[];
  onClose: () => void;
}) {
  const { result, metric } = view;
  const title = metricTitle(result.metric);
  const ref = result.reference;
  const notice = cardNotice(result);
  const classRows = Object.entries(metric.classTotals).filter(([, v]) => parseFloat(v) !== 0);
  const breakdown = view.secondary.filter((s) => s.person === null);
  const personal = view.secondary.filter((s) => s.person !== null);

  return (
    <ModalShell
      title={`${title} comparison`}
      onCancel={onClose}
      wide
      headerAction={
        <button type="button" className="modal-secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="cmp-details" data-cmp-details={result.metric}>
        {notice && (
          <div className={`cmp-notice cmp-notice-${notice.tone}`}>
            <strong>{notice.title}</strong>
            <span>{notice.body}</span>
          </div>
        )}

        <section>
          <h3 className="cmp-details-heading">Your figure</h3>
          <div className="cmp-detail-values">
            <div className="cmp-detail-value">
              <span>{metric.origin.kind === "entered" ? "Entered by you" : "Tracked in Vault Spend"}</span>
              <strong>{metric.value === null ? "Not available" : formatWhole(metric.value)}</strong>
            </div>
            {ref && result.dollarDifference !== null && (
              <div className="cmp-detail-value">
                <span>Compared with {ref.reference.statistic === "median" ? "the median" : "the average"}</span>
                <strong>{formatWhole(ref.adjustedValue)}</strong>
              </div>
            )}
          </div>
          {ref && result.dollarDifference !== null && (
            <p className="cmp-difference">{differenceText(result.dollarDifference, result.percentDifference)}</p>
          )}
          {metric.origin.kind === "entered" && (
            <p className="cmp-detail-note">
              Entered on {metric.origin.measuredOn}
              {metric.origin.explanation.trim() === "" ? "." : `: ${metric.origin.explanation.trim()}`}
              {metric.origin.stale && <strong> This figure may be out of date; it is still being used.</strong>}
            </p>
          )}
          {metric.trackedValue !== null && metric.origin.kind === "entered" && (
            <p className="cmp-detail-note">Your tracked accounts add up to {formatWhole(metric.trackedValue)}; your entered total is used instead.</p>
          )}
          {metric.notes.map((n) => (
            <p key={n.code + n.detail} className="cmp-detail-note">
              {n.detail}
            </p>
          ))}
        </section>

        {metric.contributors.length > 0 && (
          <section>
            <h3 className="cmp-details-heading">What is counted</h3>
            {metric.contributors.map((c, i) => (
              <div key={`${c.label}-${i}`} className="cmp-breakdown">
                <span>
                  {c.label}
                  {c.shareBasisPoints < 10000 && <span className="cmp-share"> · your share {c.shareBasisPoints / 100}%</span>}
                </span>
                <b>{formatWhole(c.counted)}</b>
              </div>
            ))}
            {parseFloat(metric.unallocated) > 0 && (
              <div className="cmp-breakdown cmp-breakdown-warn">
                <span>Not assigned to anyone</span>
                <b>{formatWhole(metric.unallocated)}</b>
              </div>
            )}
          </section>
        )}

        {classRows.length > 0 && (
          <section>
            <h3 className="cmp-details-heading">{result.metric === "debt" ? "By type of debt" : "By type of account"}</h3>
            {classRows.map(([key, value]) => (
              <div key={key} className="cmp-breakdown">
                <span>{CLASS_LABELS[key] ?? key}</span>
                <b>{formatWhole(value)}</b>
              </div>
            ))}
          </section>
        )}

        {breakdown.length > 0 && (
          <section>
            <h3 className="cmp-details-heading">Also compared</h3>
            {breakdown.map((s) => {
              const n = cardNotice(s.result);
              return (
                <div key={s.definitionId} className="cmp-breakdown" data-cmp-secondary={s.definitionId}>
                  <span>
                    {s.label}
                    {n && <span className="cmp-share"> · {n.title}</span>}
                  </span>
                  <b>
                    {s.result.dollarDifference !== null && s.result.reference
                      ? `${formatWhole(s.result.localValue ?? "0")} vs ${formatWhole(s.result.reference.adjustedValue)}`
                      : s.result.localValue !== null
                        ? formatWhole(s.result.localValue)
                        : "—"}
                  </b>
                </div>
              );
            })}
          </section>
        )}

        {(personal.length > 0 || view.personalIncomeHint) && (
          <section>
            <h3 className="cmp-details-heading">Each person&apos;s income</h3>
            {view.personalIncomeHint && (
              <p className="modal-message-secondary" data-cmp-personal-hint>
                Enter income for each person to also see how each person&apos;s pay compares with people their age.
              </p>
            )}
            {personal.map((s) => {
              const name = personLabel(s.person!, members);
              const key = personKey(s.person!);
              const line = s.result.reference;
              if (s.result.status === "cohort_choice_required") {
                return (
                  <p key={key} className="modal-message-secondary" data-cmp-personal={key}>
                    Enter an exact age, or a range inside one age group, to compare {name}&apos;s income.
                  </p>
                );
              }
              const n = cardNotice(s.result);
              return (
                <div key={key} className="cmp-breakdown" data-cmp-personal={key}>
                  <span>
                    {line ? `${name}, compared with ages ${ageGroupLabel(line.reference.ageMin, line.reference.ageMax)}` : name}
                    {n && <span className="cmp-share"> · {n.title}</span>}
                  </span>
                  <b>
                    {s.result.dollarDifference !== null && line
                      ? `${formatWhole(s.result.localValue ?? "0")} vs ${formatWhole(line.adjustedValue)}`
                      : s.result.localValue !== null
                        ? formatWhole(s.result.localValue)
                        : "—"}
                  </b>
                </div>
              );
            })}
          </section>
        )}

        {metric.excluded.length > 0 && (
          <section>
            <h3 className="cmp-details-heading">Left out</h3>
            {metric.excluded.map((e, i) => (
              <div key={`${e.label}-${i}`} className="cmp-breakdown">
                <span>{e.label}</span>
                <span className="cmp-share">{EXCLUDE_TEXT[e.reason]}</span>
              </div>
            ))}
          </section>
        )}

        {ref && (
          <section data-cmp-reference-details>
            <h3 className="cmp-details-heading">The published figure</h3>
            <div className="cmp-breakdown">
              <span>Population</span>
              <b>{ref.reference.population}</b>
            </div>
            <div className="cmp-breakdown">
              <span>Peers included</span>
              <b>{populationLabel(ref.reference.universe)}</b>
            </div>
            <div className="cmp-breakdown">
              <span>Age group</span>
              <b>{ageGroupLabel(ref.reference.ageMin, ref.reference.ageMax)}</b>
            </div>
            <div className="cmp-breakdown">
              <span>Statistic</span>
              <b>{ref.reference.statistic === "median" ? "Median" : "Average"}</b>
            </div>
            <div className="cmp-breakdown">
              <span>Period</span>
              <b>{referencePeriodLabel(ref.reference.period)}</b>
            </div>
            <div className="cmp-breakdown">
              <span>As published</span>
              <b>
                {formatWhole(ref.reference.value)} ({ref.reference.dollarBasis.period} dollars)
              </b>
            </div>
            <div className="cmp-breakdown">
              <span>Adjusted for inflation to {ref.adjustedBasisMonth}</span>
              <b>{formatWhole(ref.adjustedValue)}</b>
            </div>
            {ref.reference.uncertainty && (
              <div className="cmp-breakdown">
                <span>{ref.reference.uncertainty.kind === "se" ? "Standard error" : "Margin of error (90%)"}</span>
                <b>± {formatWhole(ref.adjustedUncertainty?.value ?? ref.reference.uncertainty.value)}</b>
              </div>
            )}
            {ref.reference.annotation && <p className="cmp-detail-note">{ref.reference.annotation}</p>}
            <p className="cmp-detail-note">
              Source: {sourceLabel(ref.reference.sourceId)} ({ref.reference.sourceLocator}).{" "}
              <button type="button" className="cmp-link" onClick={() => void openUrl(ref.reference.sourceUrl)}>
                Open the source
              </button>
            </p>
          </section>
        )}

        <section className="cmp-detail-copy">
          <h3 className="cmp-details-heading">How to read this</h3>
          <p>
            The difference is your figure minus the published {ref?.reference.statistic === "mean" ? "average" : "median"}, and the percentage is that
            difference as a share of the published figure. It says how far you are from a typical figure, not where you rank: a median or average does not
            tell you what share of people are above or below you.
          </p>
          <p>
            Published figures describe a past period, so they are brought up to the latest prices on file using the Consumer Price Index. That adjusts for
            inflation; it does not make an old survey a current one. Everything is calculated on this computer; nothing about you is sent anywhere.
          </p>
        </section>
      </div>
    </ModalShell>
  );
}
