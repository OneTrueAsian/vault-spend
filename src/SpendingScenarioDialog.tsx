import { CHANGED_HEADING } from "./askVault/changedState";
import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { ModalShell } from "./Modal";
import "./SpendingScenarioDialog.css";
import { date as isDate } from "./contractChecks";
import { DateField } from "./DateField";
import { useFieldValidity } from "./calendar/useFieldValidity";
import { dateOutOfRange, DATE_RANGE_PROBLEM } from "./dateRange";
import { scenarioBaselineProblem } from "./askVault/spendingScenarioMath";
import type { ScenarioBaseline, SpendingScenarioCalculation, SpendingScenarioDraft, SpendingScenarioIntent } from "./askVault/spendingScenarioContract";
import {
  ROUNDING_NOTE,
  assumptionText,
  baselineRows,
  countedMonths,
  datesText,
  longDate,
  monthCount,
  partMonthHint,
  partMonthLegend,
  partMonthText,
  partMonths,
  reductionText,
  resultView,
  typedDollars,
  usualMonthText,
  wholeMonthsOnly,
} from "./askVault/spendingScenarioView";

/** A complete, explicit schedule. The dialog never hands back an open or defaulted date. */
export type ScenarioRange = { kind: "prospective" | "full-year-hypothetical"; from: string; to: string };

/** What the person decided on the first screen. Only the questions that were asked are present. */
export type ScenarioChoiceAnswers = {
  cadence?: "monthly" | "once";
  /** Present when the dates were chosen here, or when "whole months only" moved the ends of the person's own dates. */
  range?: ScenarioRange;
  partialMonth?: "exclude" | "prorate" | "none";
};

/** What the person decided about the baseline on the review screen. */
export type ScenarioBaselineChoice = { kind: "recorded"; shortHistoryAccepted?: true } | { kind: "manual"; monthlyAmount: string };

export type ScenarioTerm = "category" | "reduction" | "horizon" | "partial-month";

export type SpendingScenarioScreen =
  | { stage: "choices"; draft: SpendingScenarioDraft; today: string }
  | { stage: "reading"; category: string }
  | { stage: "review"; intent: SpendingScenarioIntent; baseline: ScenarioBaseline }
  | { stage: "result"; calculation: Extract<SpendingScenarioCalculation, { kind: "preview" }> }
  | { stage: "refused"; intent: SpendingScenarioIntent; baseline: ScenarioBaseline }
  | { stage: "stale"; message: string }
  | { stage: "error"; message: string };

export type SpendingScenarioDialogProps = {
  screen: SpendingScenarioScreen;
  onChoices: (answers: ScenarioChoiceAnswers) => void;
  onConfirm: (choice: ScenarioBaselineChoice) => void;
  onChangeTerm: (term: ScenarioTerm) => void;
  /** "Use my own usual month" on a refused one-time cut. */
  onManualBaseline: () => void;
  /** "Change the details" on a result and "Change the amount" on a refusal. */
  onEdit: () => void;
  /** "Start again" and "Try again". */
  onRestart: () => void;
  onClose: () => void;
};

/** A plain amount a person can type: no signs, no separators, at most two decimals. */
const CAUTION = "This is an illustration of lower planned spending. It is not money promised to be in your bank account, and it leaves out any investment growth. Nothing in your data was changed.";
const IMPORT_CAVEAT = "A month counts when your records cover it. I cannot tell if you forgot to import something.";

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}

/** Stage changes can remove the focused control while the shared modal remains mounted. */
function ScenarioShell({ stage, children, ...props }: ComponentProps<typeof ModalShell> & { stage: SpendingScenarioScreen["stage"] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    // A pending read must never take focus from a dialog opened above this one.
    if (dialog && dialogs[dialogs.length - 1] === dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, [stage]);
  return <ModalShell {...props}><span ref={anchor} hidden />{children}</ModalShell>;
}

function Option({ name, label, hint, checked, disabled, onChange }: { name: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <label className="scenario-option" aria-disabled={disabled || undefined}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

function MonthsTable({ baseline, category }: { baseline: ScenarioBaseline; category: string }) {
  const rows = baselineRows(baseline);
  if (rows.length === 0) return null;
  return (
    <div className="modal-table-scroll">
      <table className="scenario-table">
        <caption>The last three full months of {category}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className="amount-col">
              Spent
            </th>
            <th scope="col">Used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month}>
              <th scope="row">{row.month}</th>
              <td className="amount-col">{row.spent}</td>
              <td>
                <span className={row.counted ? "scenario-tag" : "scenario-tag scenario-tag-out"}>{row.counted ? "Counted" : `Left out: ${row.reason}`}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Horizon = "remaining-year" | "full-year" | "custom";
type PartChoice = "whole" | "prorate";

/** Everything the person has typed or picked. Reset whenever the screen shown is a different one. */
type Form = {
  cadence: "monthly" | "once" | null;
  horizon: Horizon | null;
  customFrom: string;
  customTo: string;
  onceDate: string;
  part: PartChoice | null;
  baseline: "recorded" | "manual" | null;
  manual: string;
  manualProblem: boolean;
};

function initialForm(screen: SpendingScenarioScreen): Form {
  return {
    cadence: screen.stage === "choices" ? screen.draft.cadence : null,
    horizon: null,
    customFrom: "",
    customTo: "",
    onceDate: "",
    part: null,
    baseline: null,
    manual: screen.stage === "review" && screen.baseline.kind === "manual" ? screen.baseline.monthlyAmount : "",
    manualProblem: false,
  };
}

/** Why a typed schedule cannot be used, or null when it can (or is not finished yet). */
function customProblem(from: string, to: string, today: string): string | null {
  if (!isDate(from) || !isDate(to)) return null;
  if (dateOutOfRange(from) || dateOutOfRange(to)) return DATE_RANGE_PROBLEM;
  if (from < today) return "The schedule can't start before today.";
  if (to < from) return "The end can't be before the start.";
  if (monthCount({ from, to }) > 12) return "Choose dates within 12 months.";
  return null;
}

const monthlyIntent = (from: string, to: string, kind: ScenarioRange["kind"] = "prospective") => ({ cadence: "monthly", horizon: { kind, from, to } }) as SpendingScenarioIntent;

export function SpendingScenarioDialog({ screen, onChoices, onConfirm, onChangeTerm, onManualBaseline, onEdit, onRestart, onClose }: SpendingScenarioDialogProps) {
  const group = useId();
  const [form, setForm] = useState<Form>(() => initialForm(screen));
  // A different screen (a new draft, another stage) starts clean: answers given for the last one must not carry over.
  const identity = JSON.stringify(screen);
  const [seen, setSeen] = useState(identity);
  if (seen !== identity) {
    setSeen(identity);
    setForm(initialForm(screen));
  }
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  // Half-typed text in a date box leaves the last good date in the form; the choices must wait for it.
  const dates = useFieldValidity();

  const close = (
    <button type="button" className="modal-secondary" onClick={onClose}>
      Close
    </button>
  );

  // ---- choices ----
  if (screen.stage === "choices") {
    const { draft, today } = screen;
    const year = today.slice(0, 4);
    const unsupported = draft.missing.filter((item) => item === "category" || item === "reduction");
    // A one-time cut is a fixed dollar amount on one day. A percentage, or a whole-year what-if, can only be taken every month.
    const percent = draft.reduction?.kind === "percent";
    const wholeYear = draft.horizon?.kind === "full-year-hypothetical";
    const onceProblem = percent ? "A one-time cut needs a dollar amount, not a percentage." : wholeYear ? "A whole-year what-if is counted every month." : null;
    const blocked = draft.cadence === "once" && onceProblem !== null;
    const asksCadence = draft.missing.includes("cadence");
    const cadence = asksCadence ? form.cadence : draft.cadence;
    // A one-time cut needs exactly one day, even when the person's own dates cover several months.
    const ownRange = draft.horizon;
    const needsOneDay = cadence === "once" && (draft.missing.includes("horizon") || (ownRange !== null && ownRange.from !== ownRange.to));
    const asksHorizon = (draft.missing.includes("horizon") || needsOneDay) && cadence !== null;
    const amount = draft.reduction ? (draft.reduction.kind === "money" ? typedDollars(draft.reduction.amount) : `${draft.reduction.amount}%`) : null;

    // The schedule being asked about: the person's own, or the one chosen below. Never today's by default.
    let range: ScenarioRange | null = needsOneDay ? null : draft.horizon;
    let problem: string | null = null;
    const earliest = ownRange && ownRange.from > today ? ownRange.from : today;
    if (!range && asksHorizon) {
      if (cadence === "once") {
        if (isDate(form.onceDate)) {
          if (dateOutOfRange(form.onceDate)) problem = DATE_RANGE_PROBLEM;
          else if (form.onceDate < today) problem = "The date can't be before today.";
          else if (ownRange && (form.onceDate < ownRange.from || form.onceDate > ownRange.to)) problem = `The date has to be inside your dates, ${longDate(ownRange.from)} to ${longDate(ownRange.to)}.`;
          else range = { kind: "prospective", from: form.onceDate, to: form.onceDate };
        }
      } else if (form.horizon === "remaining-year") range = { kind: "prospective", from: today, to: `${year}-12-31` };
      else if (form.horizon === "full-year") range = { kind: "full-year-hypothetical", from: `${year}-01-01`, to: `${year}-12-31` };
      else if (form.horizon === "custom") {
        problem = customProblem(form.customFrom, form.customTo, today);
        if (isDate(form.customFrom) && isDate(form.customTo) && !problem) range = { kind: "prospective", from: form.customFrom, to: form.customTo };
      }
    }

    const monthly = cadence === "monthly";
    const parts = monthly && range && range.kind !== "full-year-hypothetical" ? partMonths(range) : [];
    const asksPart = monthly && parts.length > 0 && (draft.missing.includes("partial-month") || asksHorizon);
    const whole = range && asksPart ? wholeMonthsOnly(range) : null;
    const ready = dates.valid && unsupported.length === 0 && !blocked && (!asksCadence || form.cadence !== null) && cadence !== null && range !== null && (!asksPart || form.part !== null);

    const finish = () => {
      if (!range) return;
      const out: ScenarioChoiceAnswers = {};
      if (asksCadence && form.cadence) out.cadence = form.cadence;
      let finalRange = range;
      if (cadence === "once") {
        out.partialMonth = "none";
      } else if (asksPart) {
        if (form.part === "whole" && whole) finalRange = { ...range, ...whole };
        out.partialMonth = form.part === "prorate" ? "prorate" : "exclude";
      } else if (draft.missing.includes("partial-month") || asksHorizon) {
        out.partialMonth = "exclude";
      }
      if (asksHorizon || finalRange !== range) out.range = finalRange;
      onChoices(out);
    };

    return (
      <ScenarioShell stage={screen.stage}
        title="Before I work this out"
        onCancel={onClose}
        wide
        dismissOnOverlayClick={false}
        footer={
          <Actions>
            {close}
            {unsupported.length === 0 && !blocked && (
              <button type="button" disabled={!ready} onClick={finish}>
                Review the details
              </button>
            )}
          </Actions>
        }
      >
        <p className="scenario-banner scenario-banner-warn" role="status">
          <strong>Nothing has been calculated yet.</strong> {unsupported.length ? "I need a little more from" : "I need a few answers about"} "{draft.sourceText}".
        </p>
        {draft.scheduleHints && draft.scheduleHints.length > 0 && (
          <aside className="scenario-banner" aria-label="Dates mentioned in your question">
            <p>You mentioned these dates. Choose the exact schedule below before continuing.</p>
            <ul>{draft.scheduleHints.map((hint, index) => <li key={`${hint.start}-${index}`}>{hint.text}</li>)}</ul>
            {draft.scheduleHints.filter(hint => hint.kind === "single-date" && hint.date).map(hint => (
              <button key={hint.start} type="button" className="modal-secondary" onClick={() => {
                if (cadence === "once") set({ onceDate: hint.date! });
                else set({ horizon: "custom", customFrom: hint.date!, customTo: "", part: null });
              }}>{cadence === "once" ? "Use this date" : "Use this as the start date"}: {longDate(hint.date!)}</button>
            ))}
          </aside>
        )}
        {blocked && (
          <p className="scenario-banner scenario-banner-error" role="alert">
            {onceProblem} Ask again with a monthly cut.
          </p>
        )}
        {unsupported.length > 0 && <p>Ask again and name the {unsupported.map((item) => (item === "category" ? "category" : "amount")).join(" and the ")} you mean.</p>}
        {unsupported.length === 0 && !blocked && asksCadence && (
          <fieldset className="scenario-question">
            <legend>How often would you spend {amount ? `${amount} ` : ""}less?</legend>
            <Option name={`${group}-cadence`} label="Every month" checked={form.cadence === "monthly"} onChange={() => set({ cadence: "monthly", part: null })} />
            <Option name={`${group}-cadence`} label="Just once" hint={onceProblem ?? "Counts a single day, with no monthly limit."} checked={form.cadence === "once"} disabled={onceProblem !== null} onChange={() => set({ cadence: "once", part: null })} />
          </fieldset>
        )}
        {unsupported.length === 0 && !blocked && asksHorizon && cadence === "once" && (
          <fieldset className="scenario-question">
            <legend>Which date?</legend>
            <div className="modal-field scenario-date">
              <span>Date</span>
              <DateField value={form.onceDate} min={earliest} max={ownRange?.to} ariaLabel="Date of the one-time cut" onChange={(iso) => set({ onceDate: iso })} onValidityChange={dates.track("once")} />
            </div>
            <p className="modal-message-secondary scenario-secondary">A one-time cut counts once, on the date you choose. It can't be earlier than today.</p>
            {problem && (
              <p className="scenario-problem" role="alert">
                {problem}
              </p>
            )}
          </fieldset>
        )}
        {unsupported.length === 0 && !blocked && asksHorizon && cadence === "monthly" && (
          <fieldset className="scenario-question">
            <legend>Which dates should I use?</legend>
            <Option name={`${group}-horizon`} label={`From now until December 31, ${year}`} hint={`Today is ${longDate(today)}.`} checked={form.horizon === "remaining-year"} onChange={() => set({ horizon: "remaining-year", part: null })} />
            <Option name={`${group}-horizon`} label={`The whole of ${year} as a what-if`} hint={`January 1 to December 31, ${year}. It includes months that have already passed.`} checked={form.horizon === "full-year"} onChange={() => set({ horizon: "full-year", part: null })} />
            <Option name={`${group}-horizon`} label="Dates I choose" hint="Up to 12 months, starting today or later." checked={form.horizon === "custom"} onChange={() => set({ horizon: "custom", part: null })} />
            {form.horizon === "custom" && (
              <div className="scenario-dates">
                <div className="modal-field">
                  <span>Start</span>
                  <DateField value={form.customFrom} min={today} ariaLabel="Schedule start" onChange={(iso) => set({ customFrom: iso, part: null })} onValidityChange={dates.track("from")} />
                </div>
                <div className="modal-field">
                  <span>End</span>
                  <DateField value={form.customTo} min={today} ariaLabel="Schedule end" onChange={(iso) => set({ customTo: iso, part: null })} onValidityChange={dates.track("to")} />
                </div>
                {range && <p className="modal-message-secondary scenario-secondary">{datesText(monthlyIntent(range.from, range.to))}</p>}
                {problem && (
                  <p className="scenario-problem" role="alert">
                    {problem}
                  </p>
                )}
              </div>
            )}
          </fieldset>
        )}
        {unsupported.length === 0 && !blocked && asksPart && (
          <fieldset className="scenario-question">
            <legend>{partMonthLegend(parts)} How should I count it?</legend>
            <Option
              name={`${group}-part`}
              label="Count only whole months"
              hint={whole ? datesText(monthlyIntent(whole.from, whole.to)) : "That leaves no whole month in your dates."}
              checked={form.part === "whole"}
              disabled={whole === null}
              onChange={() => set({ part: "whole" })}
            />
            <Option
              name={`${group}-part`}
              label={parts.length > 1 ? "Count the part months by the day" : "Count the part month by the day"}
              hint={parts.map(partMonthHint).join(" ")}
              checked={form.part === "prorate"}
              onChange={() => set({ part: "prorate" })}
            />
          </fieldset>
        )}
      </ScenarioShell>
    );
  }

  // ---- reading ----
  if (screen.stage === "reading") {
    return (
      <ScenarioShell stage={screen.stage}
        title={`What if you spent less on ${screen.category}?`}
        onCancel={onClose}
        wide
        footer={
          <Actions>
            <button type="button" className="modal-secondary" onClick={onClose}>
              Cancel
            </button>
          </Actions>
        }
      >
        <p role="status">Reading your last three months of {screen.category}…</p>
        <p className="modal-message-secondary scenario-secondary">Nothing has been calculated yet.</p>
      </ScenarioShell>
    );
  }

  // ---- review (also the manual-baseline path) ----
  if (screen.stage === "review") {
    const { intent, baseline } = screen;
    const counted = countedMonths(baseline);
    const usual = usualMonthText(baseline);
    const manualGiven = baseline.kind === "manual";
    const none = baseline.kind === "recorded" && counted === 0;
    const short = baseline.kind === "recorded" && counted > 0 && counted < 3;
    const manualOnly = manualGiven || none || (short && form.baseline === "manual");
    const waiting = short && form.baseline === null;
    const confirm = () => {
      if (manualOnly) {
        const typed = form.manual.trim();
        if (scenarioBaselineProblem({ kind: "manual", monthlyAmount: typed, source: baseline.source })) {
          set({ manualProblem: true });
          return;
        }
        onConfirm({ kind: "manual", monthlyAmount: typed });
      } else if (short) {
        onConfirm({ kind: "recorded", shortHistoryAccepted: true });
      } else {
        onConfirm({ kind: "recorded" });
      }
    };
    const terms: { label: string; value: string; term: ScenarioTerm }[] = [
      { label: "Category", value: intent.category, term: "category" },
      { label: "Spend less by", value: reductionText(intent), term: "reduction" },
      { label: intent.cadence === "once" ? "Date" : "Dates", value: datesText(intent), term: "horizon" },
    ];
    const part = partMonthText(intent);
    if (part) terms.push({ label: "Part months", value: part, term: "partial-month" });
    const asOf = longDate(baseline.source.asOf);
    return (
      <ScenarioShell stage={screen.stage}
        title={none ? "I cannot tell what a usual month is" : "Check these details"}
        onCancel={onClose}
        wide
        dismissOnOverlayClick={false}
        footer={
          <Actions>
            {close}
            <button type="button" disabled={waiting} onClick={confirm}>
              {none ? "Use this amount" : "Show what I would save"}
            </button>
          </Actions>
        }
      >
        {none && (
          <p className="scenario-banner scenario-banner-error" role="alert">
            <strong>None of the last three months has complete records for {intent.category}.</strong> I have not calculated anything.
          </p>
        )}
        {short && (
          <p className="scenario-banner scenario-banner-warn" role="status">
            <strong>Only {counted} of the last 3 months can be used.</strong>{" "}
            {(() => {
              const out = baselineRows(baseline).filter((row) => !row.counted);
              return `${out.map((row) => `${row.month.split(" ")[0]} (${row.reason})`).join(", ")} ${out.length === 1 ? "is" : "are"} left out rather than counted as $0.00.`;
            })()}
          </p>
        )}
        <p className="modal-message-secondary scenario-secondary">I will use exactly what is listed here. Change anything that is not right.</p>
        <dl className="scenario-terms">
          {terms.map((row) => (
            <div key={row.term} className="scenario-term">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
              <dd>
                <button type="button" className="scenario-link" aria-label={`Change ${row.label.toLowerCase()}`} onClick={() => onChangeTerm(row.term)}>
                  Change
                </button>
              </dd>
            </div>
          ))}
        </dl>
        <p className="modal-message-secondary scenario-secondary scenario-assumption">{assumptionText(intent)}</p>
        <p className="modal-message-secondary scenario-secondary scenario-source">
          {manualGiven
            ? `Based on the usual month you entered for ${intent.category}, not on your records, as of ${asOf}.`
            : `Based on every account and everyone in your household, ${intent.category} spending only, as of ${asOf}.`}
        </p>
        <MonthsTable baseline={baseline} category={intent.category} />
        {usual && !manualGiven && (
          <p>
            <strong>
              A usual month of {intent.category}: {usual}
            </strong>
            {counted === 3 ? ". That is the three months added up and divided by three. Nothing is left out, so one big month does count." : `, from ${counted} ${counted === 1 ? "month" : "months"}.`}
          </p>
        )}
        {!manualGiven && <p className="modal-message-secondary scenario-secondary">{IMPORT_CAVEAT}</p>}
        {short && (
          <fieldset className="scenario-question">
            <legend>Which would you like to use?</legend>
            <Option name={`${group}-baseline`} label={`Use the ${counted} ${counted === 1 ? "month" : "months"} I have`} hint="This average rests on less history, so it may be off." checked={form.baseline === "recorded"} onChange={() => set({ baseline: "recorded" })} />
            <Option name={`${group}-baseline`} label="Enter a usual month myself" hint="Your own number. It is not checked against your records." checked={form.baseline === "manual"} onChange={() => set({ baseline: "manual" })} />
          </fieldset>
        )}
        {manualOnly && (
          <>
            <label className="modal-field scenario-manual">
              What is a usual month of {intent.category} for you?
              <input
                inputMode="decimal"
                value={form.manual}
                aria-invalid={form.manualProblem}
                aria-describedby={`${group}-manual-note`}
                onChange={(event) => set({ manual: event.target.value, manualProblem: false })}
              />
            </label>
            {form.manualProblem && (
              <p className="scenario-problem" role="alert">
                Enter an amount like 300 or 300.50.
              </p>
            )}
            <p className="modal-message-secondary scenario-secondary" id={`${group}-manual-note`}>
              This is your own number. It is not checked against your records.
            </p>
          </>
        )}
      </ScenarioShell>
    );
  }

  // ---- result ----
  if (screen.stage === "result") {
    const { calculation } = screen;
    const { baseline, intent } = calculation.scenario;
    const view = resultView(calculation);
    const rows = view.rows;
    const counted = countedMonths(baseline);
    return (
      <ScenarioShell stage={screen.stage}
        title="What you would save"
        onCancel={onClose}
        wide
        footer={
          <Actions>
            <button type="button" className="modal-secondary" onClick={onEdit}>
              Change the details
            </button>
            <button type="button" onClick={onClose}>
              Done
            </button>
          </Actions>
        }
      >
        <div className="scenario-result" role="status">
          <p className="scenario-lead">{view.headline}</p>
          <p className="scenario-total">{view.total}</p>
          {view.basis && <p>{view.basis}</p>}
          <p>{view.limit}</p>
          {view.hypothetical && <p>{view.hypothetical}</p>}
        </div>
        {rows.length > 0 && (
          <details open={rows.length <= 5}>
            <summary>Month by month{rows.length > 5 ? ` (${rows.length} months)` : ""}</summary>
            <div className="modal-table-scroll">
              <table className="scenario-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="amount-col">
                      Saved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td className="amount-col">{row.saving}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Total</th>
                    <td className="amount-col">
                      <strong>{view.total}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {view.rowsNeedRoundingNote && <p className="modal-message-secondary scenario-secondary">{ROUNDING_NOTE}</p>}
          </details>
        )}
        <details>
          <summary>How the usual month was worked out</summary>
          {baseline.kind === "manual" ? (
            <p>
              You entered {view.usualMonth} as a usual month of {intent.category}. It was not checked against your records.
            </p>
          ) : (
            <>
              <MonthsTable baseline={baseline} category={intent.category} />
              <p className="modal-message-secondary scenario-secondary">The months marked Counted were added up and divided by how many there are: {view.usualMonth} a month.</p>
              {counted < 3 && (
                <p className="modal-message-secondary scenario-secondary">
                  This rests on {counted} {counted === 1 ? "month" : "months"}, which you chose to use.
                </p>
              )}
              <p className="modal-message-secondary scenario-secondary">{IMPORT_CAVEAT}</p>
            </>
          )}
        </details>
        <p className="scenario-caution">{CAUTION}</p>
      </ScenarioShell>
    );
  }

  // ---- refused: the cut is bigger than a usual month ----
  if (screen.stage === "refused") {
    const { intent, baseline } = screen;
    const usual = usualMonthText(baseline) ?? "$0.00";
    const asked = intent.reduction.kind === "money" ? typedDollars(intent.reduction.amount) : `${intent.reduction.amount}%`;
    return (
      <ScenarioShell stage={screen.stage}
        title="That is more than you spend"
        onCancel={onClose}
        wide
        footer={
          <Actions>
            {close}
            {intent.cadence === "once" && (
              <button type="button" className="modal-secondary" onClick={onManualBaseline}>
                Use my own usual month
              </button>
            )}
            <button type="button" onClick={onEdit}>
              Change the amount
            </button>
          </Actions>
        }
      >
        <p className="scenario-banner scenario-banner-error" role="alert">
          <strong>
            {asked}
            {intent.cadence === "monthly" ? " a month" : ""} is more than a usual month of {intent.category}.
          </strong>{" "}
          I have not calculated a result.
        </p>
        <p>
          A usual month of {intent.category} is <strong>{usual}</strong>, shown rounded to cents. Your cut is above the amount before rounding. Try a smaller amount.
        </p>
        <MonthsTable baseline={baseline} category={intent.category} />
      </ScenarioShell>
    );
  }

  // ---- stale and error ----
  const stale = screen.stage === "stale";
  return (
    <ScenarioShell stage={screen.stage}
      title={stale ? CHANGED_HEADING : "I could not do that"}
      onCancel={onClose}
      wide
      footer={
        <Actions>
          {close}
          <button type="button" onClick={onRestart}>
            {stale ? "Start again" : "Try again"}
          </button>
        </Actions>
      }
    >
      <p className={stale ? "scenario-banner scenario-banner-warn" : "scenario-banner scenario-banner-error"} role="alert">
        {stale ? screen.message : <><strong>{screen.message}</strong> Nothing was calculated.</>}
      </p>
      {stale && <p className="modal-message-secondary scenario-secondary">Nothing was saved or changed.</p>}
    </ScenarioShell>
  );
}
