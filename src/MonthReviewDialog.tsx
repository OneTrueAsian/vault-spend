import { useState } from "react";
import { ModalShell } from "./Modal";
import { formatAmount } from "./format";
import { goalPlan } from "./goalPlan";
import { monthDelta, monthName } from "./monthReview";
import type { Bucket, MonthReview } from "./types";

const STEPS = ["summary", "over_budget", "uncategorized", "goals"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS: Record<Step, string> = {
  summary: "How it went",
  over_budget: "Over budget",
  uncategorized: "Uncategorized",
  goals: "Goals",
};

function DeltaNote({ current, previous, upIsGood }: { current: number; previous: number; upIsGood: boolean }) {
  const { direction, amount } = monthDelta(current, previous);
  if (direction === "same") return <span className="review-delta">same as the month before</span>;
  const good = (direction === "up") === upIsGood;
  return (
    <span className={good ? "review-delta review-delta-good" : "review-delta review-delta-bad"}>
      {direction} {formatAmount(amount)} from the month before
    </span>
  );
}

/** A four-step close-out for one month: how it went, what went over budget,
 * what's still uncategorized, and which goals need feeding. Nothing here
 * changes data except "Finish review", which only remembers that you did it
 * so the Dashboard stops offering it. */
export function MonthReviewDialog({
  review,
  goals,
  onCategorize,
  onFinish,
  onCancel,
}: {
  review: MonthReview;
  goals: Bucket[];
  /** Close the review and open Transactions filtered to this month's uncategorized ones. */
  onCategorize: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const label = monthName(review.year, review.month);

  const income = parseFloat(review.income);
  const expenses = parseFloat(review.expenses);
  const net = income - expenses;

  const today = new Date();
  const goalRows = goals
    .map((g) => ({ goal: g, plan: goalPlan(g, today) }))
    .filter(({ plan }) => plan.status !== "no_target" && plan.status !== "reached");
  const needFeeding = goalRows.filter(({ plan }) => plan.status === "behind" || plan.status === "no_pace");
  const onTrack = goalRows.length - needFeeding.length;

  return (
    <ModalShell
      title={`${label} review`}
      onCancel={onCancel}
      wide
      headerAction={
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Close
        </button>
      }
      footer={
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0}>
            Back
          </button>
          {stepIndex < STEPS.length - 1 ? (
            <button type="button" onClick={() => setStepIndex((i) => i + 1)} data-review-next>
              Next
            </button>
          ) : (
            <button type="button" onClick={onFinish} data-review-finish>
              Finish review
            </button>
          )}
        </div>
      }
    >
      <ol className="review-steps" aria-label="Review steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === stepIndex ? "review-step review-step-active" : "review-step"} aria-current={i === stepIndex ? "step" : undefined}>
            <span className="review-step-num">{i + 1}</span>
            {STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      <div className="review-body" data-review-step={step}>
        {step === "summary" && (
          <>
            {review.reviewed && <p className="modal-message modal-message-secondary">You finished this review before — going through it again is fine.</p>}
            <dl className="review-figures">
              <div>
                <dt>Income</dt>
                <dd>
                  <span className="review-figure">{formatAmount(review.income)}</span>
                  <DeltaNote current={income} previous={parseFloat(review.prev_income)} upIsGood />
                </dd>
              </div>
              <div>
                <dt>Spending</dt>
                <dd>
                  <span className="review-figure">{formatAmount(review.expenses)}</span>
                  <DeltaNote current={expenses} previous={parseFloat(review.prev_expenses)} upIsGood={false} />
                </dd>
              </div>
              <div>
                <dt>{net >= 0 ? "Left over" : "Overspent"}</dt>
                <dd>
                  <span className={net >= 0 ? "review-figure" : "review-figure review-figure-bad"}>{formatAmount(Math.abs(net))}</span>
                  {income > 0 && net > 0 && <span className="review-delta">{Math.round((net / income) * 100)}% of income</span>}
                </dd>
              </div>
            </dl>
          </>
        )}

        {step === "over_budget" &&
          (review.over_budget.length === 0 ? (
            <p className="modal-message" data-review-empty>
              Nothing went over budget in {label}.
            </p>
          ) : (
            <>
              <p className="modal-message modal-message-secondary">
                {review.over_budget.length} {review.over_budget.length === 1 ? "category" : "categories"} spent more than budgeted.
              </p>
              <ul className="review-list">
                {review.over_budget.map((l) => (
                  <li key={l.category} data-review-over={l.category}>
                    <span className="review-list-name">{l.category}</span>
                    <span className="review-list-note">
                      {formatAmount(l.actual)} of {formatAmount(l.budgeted)}
                    </span>
                    <span className="review-list-amount review-figure-bad">{formatAmount(parseFloat(l.actual) - parseFloat(l.budgeted))} over</span>
                  </li>
                ))}
              </ul>
            </>
          ))}

        {step === "uncategorized" &&
          (review.uncategorized_count === 0 ? (
            <p className="modal-message" data-review-empty>
              Every {label} transaction has a category.
            </p>
          ) : (
            <>
              <p className="modal-message">
                {review.uncategorized_count} {review.uncategorized_count === 1 ? "transaction" : "transactions"} from {label} (
                {formatAmount(review.uncategorized_total)} in all) still {review.uncategorized_count === 1 ? "has" : "have"} no category, so{" "}
                {review.uncategorized_count === 1 ? "it isn't" : "they aren't"} counted in your budget.
              </p>
              <button type="button" onClick={onCategorize} data-review-categorize>
                Categorize {review.uncategorized_count === 1 ? "it" : "them"} now
              </button>
            </>
          ))}

        {step === "goals" &&
          (goalRows.length === 0 ? (
            <p className="modal-message" data-review-empty>
              No goals with a target to check on.
            </p>
          ) : (
            <>
              <p className="modal-message modal-message-secondary">
                {needFeeding.length === 0
                  ? "All your goals are on track."
                  : `${needFeeding.length} ${needFeeding.length === 1 ? "goal needs" : "goals need"} a boost${onTrack > 0 ? `; ${onTrack} on track` : ""}.`}
              </p>
              <ul className="review-list">
                {needFeeding.map(({ goal, plan }) => (
                  <li key={goal.id} data-review-goal={goal.name}>
                    <span className="review-list-name">{goal.name}</span>
                    <span className="review-list-note">{plan.projectedFinish ? "behind its target date" : "no recent savings"}</span>
                    <span className="review-list-amount">
                      {plan.needsPerMonth !== null ? `needs $${Math.ceil(plan.needsPerMonth).toLocaleString("en-US")}/mo` : `${formatAmount(plan.remaining ?? 0)} to go`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ))}
      </div>
    </ModalShell>
  );
}
