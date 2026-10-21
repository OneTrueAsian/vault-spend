import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ModalShell } from "./Modal";
import { MenuSelect } from "./MenuSelect";
import { MonthField } from "./MonthField";
import "./SpendingScenarioDialog.css";
import "./RetirementScenarioDialog.css";
import {
  RETIREMENT_ANNOUNCEMENTS, RETIREMENT_CHOICE_COPY, RETIREMENT_COPY, RETIREMENT_FIELDS, RETIREMENT_INVALID_SCREEN_MESSAGE, RETIREMENT_PRIMARY_ACTION, RETIREMENT_PROBLEMS, RETIREMENT_TABLE_HEADERS,
  buildExploreConfirmation, buildRetirementConfirmation, retirementAccountLabels, retirementChoicePrompts, retirementChoicesIntro, retirementCompleteEvent, retirementDepositsOnlyContent, retirementDraftWithAnswers,
  retirementExploreContent, retirementMonthUsable, retirementReadingMessage, retirementResultContent, retirementReviewChoices, retirementReviewContent, retirementSavedMonthLimitMessage, retirementUsePlanMonth, validateRetirementChoicesEvent,
  validateRetirementScreen, withRetirementMonth,
} from "./askVault/retirementScreenContract";
import type { ResultRow, RetirementChoicesEvent, RetirementDialogProps, RetirementReviewAction, RetirementReviewForm, RetirementScreen } from "./askVault/retirementScreenContract";
import { validateRetirementDraft } from "./askVault/retirementScenarioContract";

/**
 * The M5 answer screen. It renders one validated screen at a time and reports what the person did through the callbacks of RetirementDialogProps. It calculates nothing, reads and writes nothing,
 * and has no wording of its own: every sentence, label and rule comes from the screen contract (src/askVault/retirementScreenContract.ts), and consent leaves only through onConfirm carrying a
 * scenario built by the contract's builders. Mounting it, reading accounts, freshness, cancellation and lifecycle belong to the controller, not to this file.
 */

type Stage<S extends RetirementScreen["stage"]> = Extract<RetirementScreen, { stage: S }>;
type Callbacks = Pick<RetirementDialogProps, "onChoices" | "onConfirm" | "onExplore" | "onBack" | "onEdit" | "onRestart" | "onClose">;

/** A quantity of accounts above which a list of radios is replaced by the app's themed menu. */
const MAX_RADIO_ACCOUNTS = 5;
/** A plain dollar amount a person can type: no signs, separators or exponent, at most two decimals. */
const EXTRA_AMOUNT = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

function Actions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}

/** Stage changes can remove the focused control while the shared modal stays mounted, so focus returns to the dialog (never stealing it from a dialog opened above this one). */
function Shell({ stage, children, ...props }: ComponentProps<typeof ModalShell> & { stage: RetirementScreen["stage"] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const refocus = () => {
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (dialog && dialogs[dialogs.length - 1] === dialog && !dialog.contains(document.activeElement)) dialog.focus();
  };
  useLayoutEffect(refocus, [stage]);
  // The state this one replaced hands focus back to the question a tick after it unmounts; this runs after that.
  useEffect(() => { const timer = window.setTimeout(refocus, 0); return () => window.clearTimeout(timer); }, [stage]);
  return <ModalShell {...props}><span ref={anchor} hidden /><div className="retirement-content">{children}</div></ModalShell>;
}

function Option({ name, label, checked, type = "radio", onChange }: { name: string; label: string; checked: boolean; type?: "radio" | "checkbox"; onChange: () => void }) {
  return (
    <label className="scenario-option">
      <input type={type} name={name} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function TextField({ label, value, onChange, readOnly, autoFocus }: { label: string; value: string; onChange?: (value: string) => void; readOnly?: boolean; autoFocus?: boolean }) {
  return (
    <label className="modal-field">
      <span>{label}</span>
      <input inputMode="decimal" autoComplete="off" autoFocus={autoFocus} value={value} readOnly={readOnly} aria-readonly={readOnly || undefined} onChange={(event) => onChange?.(event.target.value)} />
    </label>
  );
}

function Banner({ tone, role, children }: { tone?: "warn" | "error"; role?: "status" | "alert"; children: ReactNode }) {
  return <p className={tone ? `scenario-banner scenario-banner-${tone}` : "scenario-banner"} role={role}>{children}</p>;
}

function Problem({ text }: { text: string | null }) {
  return text ? <p className="scenario-problem" role="alert">{text}</p> : null;
}

function Details({ lines }: { lines: string[] }) {
  return (
    <details className="retirement-details">
      <summary>{RETIREMENT_COPY.detailsSummary}</summary>
      <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
    </details>
  );
}

function ResultTable({ caption, rows }: { caption: string; rows: ResultRow[] }) {
  return (
    <div className="retirement-table-wrap">
      <table className="scenario-table retirement-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{RETIREMENT_TABLE_HEADERS.assumption}</th>
            <th scope="col" className="amount-col">{RETIREMENT_TABLE_HEADERS.without}</th>
            <th scope="col" className="amount-col">{RETIREMENT_TABLE_HEADERS.with}</th>
            <th scope="col" className="amount-col">{RETIREMENT_TABLE_HEADERS.difference}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="amount-col retirement-money">{row.baseline}</td>
              <td className="amount-col retirement-money">{row.scenario}</td>
              <td className="amount-col retirement-money">{row.difference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One action fires once until the screen shown changes (the card is re-created for a different screen), so a double click cannot confirm twice. */
function useOnce() {
  const fired = useRef(false);
  const [sent, setSent] = useState(false);
  return [sent, (action: () => void) => { if (fired.current) return; fired.current = true; setSent(true); action(); }] as const;
}

const CloseButton = ({ onClose }: { onClose: () => void }) => <button type="button" className="modal-secondary" onClick={onClose}>Close</button>;

// ---- choices ----------------------------------------------------------------------------------------------------------------------------------------------------
type ChoicesForm = { accountId: number | null; amount: string; amountTouched: boolean; cadence: "monthly" | "once" | null; startToday: boolean; month: string; monthSource: "typed" | "plan-candidate" | null };

function ChoicesCard({ screen, live, onChoices, onClose }: { screen: Stage<"choices">; live: RetirementDialogProps["live"] } & Pick<Callbacks, "onChoices" | "onClose">) {
  const group = useId();
  const { draft, accounts, monthCandidate, savedMonthLimit } = screen;
  const [form, setForm] = useState<ChoicesForm>({ accountId: null, amount: "", amountTouched: false, cadence: null, startToday: false, month: "", monthSource: null });
  const [sent, once] = useOnce();
  const set = (patch: Partial<ChoicesForm>) => setForm((current) => ({ ...current, ...patch }));
  const asks = (item: (typeof draft.missing)[number]) => draft.missing.includes(item);
  const asksAccount = asks("account"), asksAmount = asks("extra-amount"), asksCadence = asks("cadence"), asksStart = asks("start-date");
  // The month is asked only once the account is known, so the plan's saved month can be offered.
  const asksMonth = asks("retirement-month") && draft.accountId !== null;

  const amountShaped = EXTRA_AMOUNT.test(form.amount);
  const amountOk = amountShaped && validateRetirementDraft(retirementDraftWithAnswers(draft, { accountId: null, amount: form.amount, cadence: null, startToday: false }, live.today), live).ok;
  const filled = retirementDraftWithAnswers(draft, { accountId: form.accountId, amount: asksAmount && amountOk ? form.amount : null, cadence: form.cadence, startToday: form.startToday }, live.today);
  const monthUsable = retirementMonthUsable(form.month, live.today);

  // Everything this card asked must be answered before it reports anything; the month is asked on the next card when the account is not yet known.
  const answered = (!asksAmount || amountOk) && (!asksCadence || form.cadence !== null) && (!asksStart || form.startToday);
  let event: RetirementChoicesEvent | null = null;
  if (!answered) event = null;
  else if (draft.accountId === null) {
    if (filled.accountId !== null) {
      const candidate: RetirementChoicesEvent = { step: "account", draft: filled };
      if (validateRetirementChoicesEvent(candidate, live).ok) event = candidate;
    }
  } else {
    const resolution = draft.retirementMonth === null && form.monthSource && monthUsable ? { value: form.month, source: form.monthSource } : null;
    if (draft.retirementMonth !== null || resolution) {
      const built = retirementCompleteEvent(filled, live, resolution);
      if (built.ok) event = built.event;
    }
  }

  const labels = retirementAccountLabels(accounts);
  const prompts = retirementChoicePrompts(draft);
  return (
    <Shell stage="choices" title={RETIREMENT_ANNOUNCEMENTS.choices.heading!} onCancel={onClose} wide dismissOnOverlayClick={false}
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" disabled={event === null || sent} onClick={() => event && once(() => onChoices(event!))}>{RETIREMENT_PRIMARY_ACTION.choices}</button></Actions>}>
      <Banner>{retirementChoicesIntro(draft)}</Banner>
      {prompts.map(({ choice, prompt }) => {
        if (choice === "retirement-month" && !asksMonth) return null;
        return (
          <fieldset className="scenario-question" key={choice}>
            <legend>{prompt}</legend>
            {choice === "account" && asksAccount && (accounts.length > MAX_RADIO_ACCOUNTS ? (
              <MenuSelect ariaLabel={RETIREMENT_FIELDS.account} placeholder={RETIREMENT_FIELDS.account} fill options={labels.map((a) => ({ value: String(a.id), label: a.label }))}
                value={form.accountId === null ? "" : String(form.accountId)} onChange={(value) => set({ accountId: Number(value) })} />
            ) : labels.map((a) => <Option key={a.id} name={`${group}-account`} label={a.label} checked={form.accountId === a.id} onChange={() => set({ accountId: a.id })} />))}
            {choice === "extra-amount" && asksAmount && (
              <TextField label={RETIREMENT_CHOICE_COPY.extraAmount} value={form.amount} onChange={(value) => set({ amount: value, amountTouched: true })} />
            )}
            {choice === "cadence" && asksCadence && (
              <>
                <Option name={`${group}-cadence`} label={RETIREMENT_CHOICE_COPY.monthly} checked={form.cadence === "monthly"} onChange={() => set({ cadence: "monthly" })} />
                <Option name={`${group}-cadence`} label={RETIREMENT_CHOICE_COPY.once} checked={form.cadence === "once"} onChange={() => set({ cadence: "once" })} />
              </>
            )}
            {choice === "start-date" && asksStart && <Option type="checkbox" name={`${group}-start`} label={RETIREMENT_CHOICE_COPY.startToday} checked={form.startToday} onChange={() => set({ startToday: !form.startToday })} />}
            {choice === "retirement-month" && asksMonth && (
              <>
                {savedMonthLimit !== null && <p className="modal-message modal-message-secondary">{retirementSavedMonthLimitMessage(savedMonthLimit)}</p>}
                {monthCandidate !== null && <button type="button" className="modal-secondary" onClick={() => set({ month: monthCandidate, monthSource: "plan-candidate" })}>{retirementUsePlanMonth(monthCandidate)}</button>}
                <label className="modal-field">
                  <span>{RETIREMENT_FIELDS.retirementMonth}</span>
                  <MonthField value={form.month} min={live.today.slice(0, 7)} max="2100-12" onChange={(value) => set({ month: value, monthSource: value ? "typed" : null })} />
                </label>
              </>
            )}
          </fieldset>
        );
      })}
      <Problem text={asksAmount && form.amountTouched && !amountOk ? RETIREMENT_PROBLEMS.extraAmount : asksMonth && form.month !== "" && !monthUsable ? RETIREMENT_PROBLEMS.month : null} />
    </Shell>
  );
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------------------
function ReadingCard({ screen, onClose }: { screen: Stage<"reading"> } & Pick<Callbacks, "onClose">) {
  return (
    <Shell stage="reading" title={RETIREMENT_ANNOUNCEMENTS.reading.heading!} onCancel={onClose} wide dismissOnOverlayClick={false}
      footer={<Actions><button type="button" onClick={onClose}>{RETIREMENT_PRIMARY_ACTION.reading}</button></Actions>}>
      <p role="status">{retirementReadingMessage(screen.accountName)}</p>
    </Shell>
  );
}

// ---- review -------------------------------------------------------------------------------------------------------------------------------------------------------
type ReviewState = RetirementReviewForm & { pickMonth: boolean; month: string; touched: boolean; problem: string | null };

function ReviewCard({ screen, openReturnChoice, onConfirm, onClose }: { screen: Stage<"review">; openReturnChoice: boolean } & Pick<Callbacks, "onConfirm" | "onClose">) {
  const group = useId();
  const hasValue = screen.review.context.currentValue !== null;
  const [form, setForm] = useState<ReviewState>({ amount: "", chooseReturn: openReturnChoice && hasValue, returnPct: "", todays: false, inflation: null, pickMonth: false, month: "", touched: false, problem: null });
  const [sent, once] = useOnce();
  const set = (patch: Partial<ReviewState>) => setForm((current) => ({ ...current, ...patch }));
  const typed = (patch: Partial<ReviewState>) => set({ ...patch, touched: true, problem: null });

  // Another month the person typed replaces the plan's month; what is wrong with it is said in words.
  let review = screen.review, waiting = false, monthProblem: string | null = null;
  if (form.pickMonth) {
    if (form.month === "") waiting = true;
    else {
      const replaced = withRetirementMonth(screen.review, form.month);
      if (replaced.ok) review = replaced.review; else { waiting = true; monthProblem = replaced.reason; }
    }
  }
  const content = retirementReviewContent(review);
  const needsAmount = content.needs.includes("contribution") && hasValue;
  const reviewForm: RetirementReviewForm = { amount: form.amount, chooseReturn: form.chooseReturn, returnPct: form.returnPct, todays: form.todays, inflation: form.inflation };
  const built = buildRetirementConfirmation(review, retirementReviewChoices(review, reviewForm, "primary"));
  const confirm = (action: RetirementReviewAction) => {
    const result = buildRetirementConfirmation(review, retirementReviewChoices(review, reviewForm, action));
    if (!result.ok) set({ problem: result.reason, touched: true }); else once(() => onConfirm(result.scenario));
  };
  const entering = form.chooseReturn && hasValue;
  const facts = content.facts;
  return (
    <Shell stage="review" title={content.heading} onCancel={onClose} wide dismissOnOverlayClick={false}
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" disabled={!built.ok || waiting || sent} onClick={() => confirm("primary")}>{entering ? RETIREMENT_FIELDS.useReturn : content.primary}</button></Actions>}>
      {content.notice && <Banner tone={content.notice.tone}>{content.notice.text}</Banner>}
      <dl className="scenario-terms retirement-facts">
        {facts.map((fact) => <div className="scenario-term" key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>
      {needsAmount && <TextField label={RETIREMENT_FIELDS.manualAmount} value={form.amount} onChange={(value) => typed({ amount: value })} />}
      {hasValue && (
        <fieldset className="scenario-question">
          <legend>{RETIREMENT_FIELDS.purchasingPower}</legend>
          <Option name={`${group}-power`} label={RETIREMENT_FIELDS.futureDollars} checked={!form.todays} onChange={() => set({ todays: false })} />
          <Option name={`${group}-power`} label={RETIREMENT_FIELDS.todaysDollars} checked={form.todays} onChange={() => set({ todays: true })} />
        </fieldset>
      )}
      {form.todays && hasValue && <TextField label={RETIREMENT_FIELDS.inflation} value={form.inflation ?? content.candidates.inflationPct ?? ""} onChange={(value) => typed({ inflation: value })} />}
      {entering && <TextField autoFocus label={RETIREMENT_FIELDS.explicitReturn} value={form.returnPct} onChange={(value) => typed({ returnPct: value })} />}
      {form.pickMonth && (
        <label className="modal-field">
          <span>{RETIREMENT_FIELDS.retirementMonth}</span>
          <MonthField autoFocus value={form.month} min={review.context.source.asOf.slice(0, 7)} max="2100-12" onChange={(value) => typed({ month: value })} />
        </label>
      )}
      <Problem text={monthProblem ?? (form.touched && !built.ok ? built.reason : form.problem)} />
      <div className="retirement-actions-inline">
        {content.secondary.map((label) => {
          if (label === RETIREMENT_COPY.chooseReturn) return entering ? null : <button key={label} type="button" className="modal-secondary" onClick={() => set({ chooseReturn: true })}>{label}</button>;
          return <button key={label} type="button" className="modal-secondary" disabled={sent || waiting} onClick={() => confirm(label === RETIREMENT_COPY.usePlan ? "plan" : "deposits")}>{label}</button>;
        })}
        {screen.review.monthSource === "plan-candidate" && !form.pickMonth && <button type="button" className="modal-secondary" onClick={() => set({ pickMonth: true })}>{RETIREMENT_COPY.pickAnotherMonth}</button>}
      </div>
      <Details lines={content.details} />
    </Shell>
  );
}

// ---- results ------------------------------------------------------------------------------------------------------------------------------------------------------
function ResultCard({ screen, onExplore, onEdit, onClose }: { screen: Stage<"result"> } & Pick<Callbacks, "onExplore" | "onEdit" | "onClose">) {
  const c = retirementResultContent(screen.calculation);
  return (
    <Shell stage="result" title={c.heading} onCancel={onClose} wide
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" onClick={() => onEdit()}>{RETIREMENT_PRIMARY_ACTION.result}</button></Actions>}>
      <Banner role="status">{c.unitLine}</Banner>
      <ResultTable caption={c.dateLine} rows={c.rows} />
      {c.across && <p>{c.across}</p>}
      {c.fallback && <Banner tone="warn">{c.fallback}</Banner>}
      {c.sensitivity && <ResultTable caption={c.sensitivity.heading} rows={c.sensitivity.rows} />}
      <p>{c.exactDeposits}</p>
      <Details lines={c.details} />
      <Banner>{c.caution}</Banner>
      {c.canExplore && <div className="retirement-actions-inline"><button type="button" className="modal-secondary" onClick={onExplore}>{RETIREMENT_COPY.explore}</button></div>}
    </Shell>
  );
}

function ExploreCard({ screen, onConfirm, onBack, onClose }: { screen: Stage<"explore"> } & Pick<Callbacks, "onConfirm" | "onBack" | "onClose">) {
  const content = retirementExploreContent();
  const returns = screen.calculation.scenario.assumptions.returns, confirmedPct = returns.kind === "confirmed-return" ? returns.annualPct : null;
  const around = (offset: number) => (confirmedPct === null ? "" : String(+(Number(confirmedPct) + offset).toFixed(4)));
  const [form, setForm] = useState({ lower: around(-3), higher: around(3) });
  const [sent, once] = useOnce();
  const built = buildExploreConfirmation(screen.calculation, { lower: form.lower, base: confirmedPct ?? "", higher: form.higher });
  return (
    <Shell stage="explore" title={content.heading} onCancel={onClose} wide dismissOnOverlayClick={false}
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" className="modal-secondary" onClick={onBack}>{RETIREMENT_COPY.backToResult}</button>
        <button type="button" disabled={!built.ok || sent} onClick={() => built.ok && once(() => onConfirm(built.scenario))}>{content.primary}</button></Actions>}>
      <p>{content.intro}</p>
      <div className="retirement-inline-fields">
        <TextField label={content.labels[0]} value={form.lower} onChange={(value) => setForm((f) => ({ ...f, lower: value }))} />
        <TextField label={content.labels[1]} value={confirmedPct ?? ""} readOnly />
        <TextField label={content.labels[2]} value={form.higher} onChange={(value) => setForm((f) => ({ ...f, higher: value }))} />
      </div>
      <Problem text={built.ok ? null : built.reason} />
    </Shell>
  );
}

function DepositsCard({ screen, onEdit, onClose }: { screen: Stage<"deposits-only"> } & Pick<Callbacks, "onEdit" | "onClose">) {
  const c = retirementDepositsOnlyContent(screen.calculation);
  return (
    <Shell stage="deposits-only" title={c.heading} onCancel={onClose} wide
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" onClick={() => (c.primary === RETIREMENT_COPY.chooseReturn ? onEdit({ chooseReturn: true }) : onEdit())}>{c.primary}</button></Actions>}>
      <p role="status"><strong>{c.exactDeposits}</strong></p>
      <Banner tone="warn">{c.fallback}</Banner>
      <p>{c.caution}</p>
      <Details lines={c.details} />
    </Shell>
  );
}

// ---- needs attention, not supported, changed, error --------------------------------------------------------------------------------------------------------------
function BlockedCard({ screen, onEdit, onClose }: { screen: Stage<"blocked"> } & Pick<Callbacks, "onEdit" | "onClose">) {
  return (
    <Shell stage="blocked" title={RETIREMENT_ANNOUNCEMENTS.blocked.heading!} onCancel={onClose} wide
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" onClick={() => onEdit()}>{RETIREMENT_PRIMARY_ACTION.blocked}</button></Actions>}>
      <Banner tone="error" role="alert">{screen.calculation.message}</Banner>
      <p>{RETIREMENT_COPY.nothingCalculated}</p>
    </Shell>
  );
}

function UnsupportedCard({ screen, onClose }: { screen: Stage<"unsupported"> } & Pick<Callbacks, "onClose">) {
  return (
    <Shell stage="unsupported" title={RETIREMENT_ANNOUNCEMENTS.unsupported.heading!} onCancel={onClose} wide
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" onClick={onClose}>{RETIREMENT_PRIMARY_ACTION.unsupported}</button></Actions>}>
      <p role="status">{screen.reason}</p>
    </Shell>
  );
}

function MessageCard({ stage, message, onRestart, onClose }: { stage: "stale" | "error"; message: string } & Pick<Callbacks, "onRestart" | "onClose">) {
  return (
    <Shell stage={stage} title={RETIREMENT_ANNOUNCEMENTS[stage].heading!} onCancel={onClose} wide
      footer={<Actions><CloseButton onClose={onClose} /><button type="button" onClick={onRestart}>{RETIREMENT_PRIMARY_ACTION[stage]}</button></Actions>}>
      <Banner tone={stage === "stale" ? "warn" : "error"} role="alert">{message}</Banner>
    </Shell>
  );
}

// ---- the dialog ---------------------------------------------------------------------------------------------------------------------------------------------------
export function RetirementScenarioDialog({ screen, live, openReturnChoice = false, onChoices, onConfirm, onExplore, onBack, onEdit, onRestart, onClose }: RetirementDialogProps) {
  // Only what the contract validates against the live context is ever shown. A result is re-checked against the calculator once per screen, not on every keystroke.
  const verdict = useMemo(() => {
    try { return validateRetirementScreen(screen, live).ok; } catch { return false; }
  }, [screen, live]);
  if (!verdict) return <MessageCard key="invalid" stage="error" message={RETIREMENT_INVALID_SCREEN_MESSAGE} onRestart={onRestart} onClose={onClose} />;
  // A different screen is a different card: its form starts clean and its one-shot actions are armed again.
  const key = JSON.stringify(screen);
  switch (screen.stage) {
    case "choices": return <ChoicesCard key={key} screen={screen} live={live} onChoices={onChoices} onClose={onClose} />;
    case "reading": return <ReadingCard key={key} screen={screen} onClose={onClose} />;
    case "review": return <ReviewCard key={key} screen={screen} openReturnChoice={openReturnChoice} onConfirm={onConfirm} onClose={onClose} />;
    case "result": return <ResultCard key={key} screen={screen} onExplore={onExplore} onEdit={onEdit} onClose={onClose} />;
    case "explore": return <ExploreCard key={key} screen={screen} onConfirm={onConfirm} onBack={onBack} onClose={onClose} />;
    case "deposits-only": return <DepositsCard key={key} screen={screen} onEdit={onEdit} onClose={onClose} />;
    case "blocked": return <BlockedCard key={key} screen={screen} onEdit={onEdit} onClose={onClose} />;
    case "unsupported": return <UnsupportedCard key={key} screen={screen} onClose={onClose} />;
    case "stale": case "error": return <MessageCard key={key} stage={screen.stage} message={screen.message} onRestart={onRestart} onClose={onClose} />;
  }
}
