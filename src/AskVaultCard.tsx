import { CHANGED_HEADING } from "./askVault/changedState";
import { traceClaimStart } from "./askVault/retirementStageTrace";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { TRANSACTION_QA_EXAMPLES } from "./transactionQa";
import { ModalShell } from "./Modal";
import { formatDisplayDate } from "./format";
import { formatMoney } from "./askVault/money";
import { useAskVault, type LegacyAnswer } from "./askVault/useAskVault";
import { useSpendingScenario } from "./askVault/useSpendingScenario";
import { SpendingScenarioDialog } from "./SpendingScenarioDialog";
import { useCutPreview, type CutPreviewClient } from "./askVault/useCutPreview";
import { CutPreviewDialog } from "./CutPreviewDialog";
import { useRetirementScenario } from "./askVault/useRetirementScenario";
import type { RetirementClient } from "./askVault/retirementContextReader";
import { RetirementScenarioDialog } from "./RetirementScenarioDialog";
import type { AskMemberSelection, Correction, Interpretation, ParseContext } from "./askVault/types";

/** Questions shown as one-click suggestions when something could not be understood. */
export const SUGGESTIONS = [
  "how much did I spend on groceries last month",
  "top 3 spending categories this year",
  "my three biggest expenses last month",
  "groceries last month without Costco",
];
/** Rows and choices shown inline; longer lists open in a dialog or sit behind a disclosure. */
const INLINE_ROWS = 5;
const INLINE_CHOICES = 3;

export const MORE_EXAMPLES = ["how much did I spend at Costco last month", "everything except rent last month", "spending by month this year", "average purchase on groceries last month", "what did each family member spend last month", "Where can I cut back to save $200 a month?", "Save $200 in total this year", "Extra $50 a month into Roth IRA until January 2056", "What if I cut Groceries by $50 a month?"];

/** The short phrases under the question that say what was understood, so a wrong reading is easy to spot. */
function understoodChips(i: Interpretation): string[] {
  const chips: string[] = [];
  if (i.kind === "rank-categories") chips.push(i.limit === 1 ? "Biggest category" : `Top ${i.limit} categories`);
  if (i.kind === "rank-purchases") chips.push(i.limit === 1 ? "Biggest purchase" : `Top ${i.limit} purchases`);
  if (i.kind === "compare") chips.push("Comparison");
  if (i.vendors.length) chips.push(`At ${i.vendors.join(", ")}`);
  const categories = i.categories ?? (i.category ? [i.category] : []);
  chips.push(...categories);
  if (i.members?.length) chips.push(`For ${i.members.join(", ")}`);
  if (i.groupBy === "member") chips.push("By family member");
  if (i.groupBy === "month") chips.push("By month");
  if (i.average === "per-purchase") chips.push("Average per purchase");
  if (i.average === "per-month") chips.push("Average per recorded month");
  if (i.alignment === "same-days-previous-month") chips.push("Same days of the previous month");
  if (i.alignment === "same-days-previous-year") chips.push("Same dates of the previous year");
  if (i.accountName) chips.push(`On ${i.accountName}`);
  if (!i.vendors.length && !categories.length && !i.accountName && !i.members?.length && i.kind !== "rank-categories") chips.push("All spending");
  for (const name of [...i.excludedVendors, ...i.excludedCategories]) chips.push(`Leaving out ${name}`);
  if (i.minimumPurchase) chips.push(`${i.minimumPurchase.inclusive ? "At least" : "Over"} ${formatMoney(i.minimumPurchase.amount)}`);
  for (const p of i.periods) chips.push(p.label);
  return chips;
}

function correctionLine(corrections: Correction[]): string | null {
  if (!corrections.length) return null;
  const parts = corrections.map((c) => `“${c.from}” as “${c.to}”`);
  return `I read ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}.`;
}

function AnswerRows({ rows, label }: { rows: { label: string; amount: string; detail: string }[]; label?: string }) {
  if (label) return (
    <div className="modal-table-scroll">
      <table className="ledger ledger-qa-breakdown" aria-label={label}>
        <caption>{label}</caption>
        <thead><tr><th scope="col">{label === "Spending by month" ? "Month" : label === "Spending by family member" ? "Family member" : label === "Compared periods" ? "Period" : label === "Spending by store" ? "Store" : "Category"}</th><th scope="col" className="amount-col">Recorded amount</th><th scope="col">Details</th></tr></thead>
        <tbody>{rows.map((row,i) => <tr key={`${row.label}-${i}`}><th scope="row">{row.label}</th><td className="amount-col">{row.amount}</td><td>{row.detail}</td></tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <ol className="ledger-qa-rows">
      {rows.map((row, i) => (
        <li key={`${row.label}-${i}`}>
          <span>{row.label}</span>
          <span className="ledger-qa-amount">{row.amount}</span>
          <span className="ledger-qa-sub">{row.detail}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Dashboard's "Ask the Vault" card. Spending questions are read exactly from the profile's own data
 * by the native side; the older question families are answered by the older matcher. Nothing leaves the
 * computer, and nothing is shown after the profile is locked or switched.
 */
export function AskVaultCard({
  getContext,
  legacyAsk,
  dataKey,
  reloadKey,
  accountNames,
  onOpenTransactions,
  createClient,
  ready = true,
}: {
  /** The loaded name roster is prepared before new questions are submitted. Typing and existing results remain available. */
  ready?: boolean;
  getContext: () => ParseContext;
  legacyAsk: (question: string) => LegacyAnswer;
  /** Changes when the ledger changes; an answer on screen is retired when it does. */
  dataKey: unknown;
  /** Changes whenever the list is reloaded; the answer is kept only if the data revision is unchanged. */
  reloadKey?: unknown;
  accountNames: Map<number, string>;
  /** Opens the Transactions tab filtered the same way as an answer; offered only when it can show exactly those purchases. */
  onOpenTransactions?: (filter: { category: string; accountIds: number[]; from: string; to: string }) => void;
  createClient?: () => CutPreviewClient & RetirementClient;
}) {
  const { view, details, checking, ask, openDetails, closeDetails, reset } = useAskVault({ getContext, legacyAsk, dataKey, reloadKey, createClient });
  const scenario = useSpendingScenario({ getContext, dataKey, reloadKey, createClient });
  const cut = useCutPreview({ getContext, dataKey, reloadKey, createClient });
  const retirement = useRetirementScenario({ getContext, dataKey, reloadKey, createClient });
  const questionInput = useRef<HTMLInputElement | null>(null);
  const [question, setQuestion] = useState("");
  const [showExamples, setShowExamples] = useState(false);
  const [exampleFilled, setExampleFilled] = useState(false);
  const tipsId = useId();
  const [allRowsOpen, setAllRowsOpen] = useState(false);
  const [placeholderExample] = useState(() => TRANSACTION_QA_EXAMPLES[Math.floor(Math.random() * TRANSACTION_QA_EXAMPLES.length)]);
  // The full list belongs to the answer it was opened from: a new answer, or none, closes it.
  useEffect(() => setAllRowsOpen(false), [view]);
  // ...and so does a re-check: nothing from an answer is shown while it is being confirmed as current.
  useEffect(() => {
    if (checking) setAllRowsOpen(false);
  }, [checking]);
  const detailsButton = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !details) detailsButton.current?.focus();
    wasOpen.current = details !== null;
  }, [details]);

  // The Transactions tab filters by one category, accounts and dates. Stores, left-out names and a
  // minimum amount have no equivalent there, so for those the purchases stay in this dialog.
  const openable = (() => {
    if (!onOpenTransactions || view.status !== "answer") return null;
    const { request } = view.result;
    const exact =
      request.categories.length === 1 &&
      request.vendors.length === 0 &&
      request.excludeVendors.length === 0 &&
      request.excludeCategories.length === 0 &&
      request.minimumPurchase === null &&
      (!("contractVersion" in request) || (request.members.ids.length === 0 && !request.members.unassigned)) &&
      request.periods.length === 1;
    return exact ? { category: request.categories[0], accountIds: request.accountIds, from: request.periods[0].from, to: request.periods[0].to } : null;
  })();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !question.trim()) return;
    runQuestion(question);
  }
  function runQuestion(next: string, members: AskMemberSelection[] = []) {
    if (!ready) return;
    cut.cancel();
    retirement.cancel();
    scenario.cancel();
    if (!members.length) {
      reset();
      // Precedence: savings targets, then extra money into an investment account, then spending scenarios, then ordinary questions.
      const endTrace = import.meta.env.TAURI_ENV_DEBUG === "true" || import.meta.env.TAURI_ENV_DEBUG === true ? traceClaimStart() : null;
      try {
        if (cut.ask(next)) return;
        if (retirement.ask(next)) return;
        if (scenario.ask(next)) return;
      } finally { endTrace?.(); }
    }
    void ask(next, members);
  }
  function choose(next: string, members: AskMemberSelection[] = []) {
    setQuestion(next);
    runQuestion(next, members);
  }
  function editScenario() {
    scenario.cancel();
    questionInput.current?.focus();
  }
  function changeQuestion(next: string) {
    cut.cancel(); retirement.cancel(); scenario.cancel(); setQuestion(next); setExampleFilled(false);
  }
  // An example only fills the box: it is not asked until the person presses Ask. Say so, and move to the box so the next key press continues from there.
  function fillExample(example: string) {
    changeQuestion(example); setExampleFilled(true); questionInput.current?.focus();
  }
  function closeCut() { cut.cancel(); questionInput.current?.focus(); }
  function closeRetirement() { retirement.cancel(); questionInput.current?.focus(); }
  // The dialog shell hands focus back to whatever had it before, a tick after it unmounts; the question field is where a person continues.
  const retirementOpen = retirement.screen !== null, retirementWasOpen = useRef(false);
  useEffect(() => {
    const closed = retirementWasOpen.current && !retirementOpen;
    retirementWasOpen.current = retirementOpen;
    if (!closed) return;
    const timer = window.setTimeout(() => questionInput.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [retirementOpen]);

  return (
    <div className="card ledger-qa-card">
      <div className="card-head">
        <span className="reports-section-title cell-with-icon">
          <MessageCircleQuestion className="category-legend-icon" />
          Ask the Vault
        </span>
        <button type="button" className="modal-secondary" aria-expanded={showExamples} aria-controls={tipsId} onClick={() => setShowExamples((v) => !v)}>
          {showExamples ? "Hide tips" : "Tips & examples"}
        </button>
      </div>
      {showExamples && (
        <div className="ledger-qa-tips" id={tipsId}>
          <p className="field-hint">
            Ask one thing at a time, using the category, account or store names you see elsewhere in the app. Add a time
            period like "this month," "last week," "July," "2026" or "the past 3 months." You can ask for a total, a top 3,
            or a comparison of two periods, name several stores ("at Meijer and Target"), or leave things out ("without
            Costco," "except rent"). You can also name several categories or family members, ask for spending by month
            or family member, or ask for an average per purchase or per recorded month. Add "same days last month" to
            compare matching dates. Monthly averages leave out months without enough recording evidence.
            You can also ask what you would save by spending less each month or just once. You review the dates
            and usual spending before any result is shown; this never changes your budget.
            For a savings target, say whether it is per month or a total over dates. You choose the categories,
            a monthly floor (the spending you want to keep) and a maximum cut for each. The preview spreads
            cuts within those limits and shows the maximum and any shortfall. Missing history needs your own
            usual-month amount; short history needs your explicit choice. You review everything before confirming.
            These are read-only spending illustrations, with no investment growth or automatic budget changes.
            To see what extra money in one investment account could add, name the account, the extra amount, monthly or once, and your retirement month. You confirm your saved plan first; this changes nothing.
          </p>
          <ul className="ledger-qa-examples">
            {[...TRANSACTION_QA_EXAMPLES, ...MORE_EXAMPLES].map((example) => (
              <li key={example}>
                <button type="button" onClick={() => fillExample(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="sr-only" role="status" data-example-status>{exampleFilled ? "Example filled in. Press Ask to run it." : ""}</p>
      <form className="category-create-form" onSubmit={submit} aria-busy={!ready}>
        <input ref={questionInput} value={question} onChange={(e) => changeQuestion(e.target.value)} placeholder={`e.g. "${placeholderExample}"`} aria-label="Your question" />
        <button type="submit" disabled={!ready || !question.trim()}>
          Ask
        </button>
      </form>
      {!ready && <p className="ledger-qa-hint" role="status">Getting ready to answer…</p>}
      <div className="ledger-qa-result" aria-live="polite">
        {cut.clarification && <div className="ledger-qa-clarify">
          <p className="ledger-qa-banner">{cut.clarification.reason} Nothing has been calculated yet.</p>
          <div className="ledger-qa-choices" role="group" aria-label="Choose a category">
            {cut.clarification.choices.map((label, index) => <button key={label} type="button" onClick={() => choose(cut.clarification!.replacements![index])}>{label}</button>)}
          </div>
          {!cut.clarification.choices.length && <p>Change your question above and ask again.</p>}
        </div>}
        {scenario.clarification && (
          <div className="ledger-qa-clarify">
            <p className="ledger-qa-banner">{scenario.clarification.reason} Nothing has been calculated yet.</p>
            <div className="ledger-qa-choices" role="group" aria-label="Choose a category">
              {scenario.clarification.choices.map((label, index) => <button key={label} type="button" onClick={() => choose(scenario.clarification!.replacements![index])}>{label}</button>)}
            </div>
            {!scenario.clarification.choices.length && <p>Change your question above and ask again.</p>}
          </div>
        )}
        {retirement.clarification && (
          <div className="ledger-qa-clarify">
            <p className="ledger-qa-banner">{retirement.clarification.reason} Nothing has been calculated yet.</p>
            {retirement.clarification.choices.length > 0 && <div className="ledger-qa-choices" role="group" aria-label="Choose one">
              {retirement.clarification.choices.map((label, index) => <button key={label} type="button" onClick={() => choose(retirement.clarification!.replacements![index])}>{label}</button>)}
            </div>}
            {!retirement.clarification.choices.length && <p>Change your question above and ask again.</p>}
          </div>
        )}
        {view.status === "loading" && <p className="ledger-qa-working">Looking that up…</p>}

        {view.status === "answer" && checking === view.result && <p className="ledger-qa-working">Checking that this is still up to date…</p>}

        {view.status === "answer" && checking !== view.result && (
          <>
            <ul className="ledger-qa-chips" aria-label="What I understood">
              {understoodChips(view.result.interpretation).map((chip, i) => (
                <li key={`${chip}-${i}`}>{chip}</li>
              ))}
            </ul>
            {correctionLine(view.result.corrections) && <p className="ledger-qa-fix">{correctionLine(view.result.corrections)}</p>}
            <div className="ledger-qa-answer">
              <p className="ledger-qa-headline">{view.result.answer.headline}</p>
              <p className="ledger-qa-detail">{view.result.answer.detail}</p>
              {view.result.answer.warnings?.map(warning => <p className="ledger-qa-caution" key={warning}>{warning}</p>)}
              {view.result.answer.rows.length > 0 && (
                <>
                  <AnswerRows rows={view.result.answer.rows.slice(0, INLINE_ROWS)} label={view.result.answer.rowsLabel} />
                  {view.result.answer.rows.length > INLINE_ROWS && (
                    <div className="ledger-qa-actions">
                      <button type="button" className="modal-secondary" onClick={() => setAllRowsOpen(true)}>
                        {`Show all ${view.result.answer.rows.length}`}
                      </button>
                    </div>
                  )}
                </>
              )}
              {view.result.answer.breakdowns?.map(section => (
                <details className="ledger-qa-notes" key={section.heading}>
                  <summary>{section.heading}</summary>
                  <AnswerRows rows={section.rows} label={section.heading} />
                </details>
              ))}
              {view.result.interpretation.kind === "total" && view.result.purchaseCount > 0 && (
                <div className="ledger-qa-actions">
                  <button ref={detailsButton} type="button" className="modal-secondary" onClick={() => void openDetails()}>
                    {`View ${view.result.purchaseCount} ${view.result.purchaseCount === 1 ? "purchase" : "purchases"}`}
                  </button>
                </div>
              )}
              {view.result.answer.matches.length > 0 && (
                <details className="ledger-qa-notes" open={view.result.answer.matches.length <= 3}>
                  <summary>Names I matched</summary>
                  <ul>
                    {view.result.answer.matches.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="ledger-qa-notes">
                <summary>What's counted</summary>
                <ul>
                  {view.result.answer.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            </div>
          </>
        )}

        {view.status === "legacy" && (
          <p className={view.matched ? "ledger-qa-answer" : "ledger-qa-answer ledger-qa-answer-unmatched"}>{view.answer}</p>
        )}

        {view.status === "clarify" && (
          <div className="ledger-qa-clarify">
            <p className="ledger-qa-banner">
              <strong>{view.reason}</strong> Nothing has been added up yet.
            </p>
            {view.choices.length > 0 && view.replacements ? (
              <div className="ledger-qa-choices" role="group" aria-label="Choose one">
                {view.choices.slice(0, INLINE_CHOICES).map((choice, i) => (
                  <button key={choice} type="button" onClick={() => choose(view.replacements![i], view.memberSelections?.[i])}>
                    {choice}
                  </button>
                ))}
                {view.choices.length > INLINE_CHOICES && (
                  <details className="ledger-qa-more">
                    <summary>More choices</summary>
                    <div className="ledger-qa-choices">
                      {view.choices.slice(INLINE_CHOICES).map((choice, i) => (
                        <button key={choice} type="button" onClick={() => choose(view.replacements![INLINE_CHOICES + i], view.memberSelections?.[INLINE_CHOICES + i])}>
                          {choice}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <p className="ledger-qa-hint">Change your question above and ask again.</p>
            )}
          </div>
        )}

        {view.status === "unsupported" && (
          <div className="ledger-qa-answer ledger-qa-answer-unmatched">
            <p>{view.reason}</p>
            <p className="ledger-qa-hint">Try something like:</p>
            <ul className="ledger-qa-examples">
              {SUGGESTIONS.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => choose(example)}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {view.status === "stale" && (
          <p className="ledger-qa-banner" role="status">
            <strong>{CHANGED_HEADING}</strong> {view.message}{" "}
            <button type="button" className="ledger-qa-link" onClick={() => void ask(view.question)}>
              Ask again
            </button>
          </p>
        )}

        {view.status === "error" && (
          <p className="ledger-qa-banner ledger-qa-banner-error" role="alert">
            <strong>{view.message}</strong>{" "}
            <button type="button" className="ledger-qa-link" onClick={() => void ask(view.question)}>
              Try again
            </button>
          </p>
        )}
      </div>

      {scenario.screen && <SpendingScenarioDialog screen={scenario.screen}
        onChoices={answers => void scenario.choose(answers)} onConfirm={choice => void scenario.confirm(choice)}
        onChangeTerm={editScenario} onEdit={editScenario} onManualBaseline={scenario.manualBaseline}
        onRestart={scenario.restart} onClose={editScenario} />}
      {retirement.screen && <RetirementScenarioDialog screen={retirement.screen} live={retirement.live} openReturnChoice={retirement.openReturnChoice}
        onChoices={event => void retirement.choices(event)} onConfirm={scenario => void retirement.confirm(scenario)} onExplore={retirement.explore} onBack={retirement.back}
        onEdit={request => retirement.edit(request)} onRestart={retirement.restart} onClose={closeRetirement} />}
      {cut.screen && <CutPreviewDialog screen={cut.screen} onChoices={intent => void cut.choose(intent)} onConfirm={confirmed => void cut.confirm(confirmed)}
        onRemoveCategory={cut.remove} onEdit={cut.edit} onRestart={cut.restart} onClose={closeCut} />}

      {allRowsOpen && view.status === "answer" && checking !== view.result && (
        <ModalShell
          title={view.result.answer.headline}
          onCancel={() => setAllRowsOpen(false)}
          footer={
            <button type="button" onClick={() => setAllRowsOpen(false)}>
              Close
            </button>
          }
        >
          <AnswerRows rows={view.result.answer.rows} label={view.result.answer.rowsLabel} />
        </ModalShell>
      )}

      {details && (
        <ModalShell
          title="The purchases behind this answer"
          onCancel={closeDetails}
          wide
          footer={
            <>
              {openable && onOpenTransactions && (
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => {
                    closeDetails();
                    onOpenTransactions(openable);
                  }}
                >
                  Open in Transactions
                </button>
              )}
              <button type="button" onClick={closeDetails}>
                Close
              </button>
            </>
          }
        >
          {view.status === "answer" && (view.result.request.kind === "compare" || view.result.interpretation.average === "per-month") && (
            <p className="modal-message-secondary">These purchases cover {view.result.interpretation.periods[0].label} with the same filters. {view.result.request.kind === "compare" ? "Only the first compared period is listed here." : "The monthly average uses only the months marked as included, rather than every purchase in this list."}</p>
          )}
          {details.status === "loading" && <p>Loading purchases…</p>}
          {details.status === "error" && <p role="alert">{details.changed && <strong>{CHANGED_HEADING} </strong>}{details.message}</p>}
          {details.status === "ready" && (
            <>
              <p className="modal-message-secondary">
                {details.rows.length < details.purchaseCount
                  ? `Showing the ${details.rows.length} biggest of ${details.purchaseCount} purchases.`
                  : `${details.purchaseCount} ${details.purchaseCount === 1 ? "purchase" : "purchases"}, the same ones that were added up.`}
              </p>
              <div className="modal-table-scroll">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Where</th>
                      <th>Account</th>
                      <th className="amount-col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.rows.map((row) => (
                      <tr key={row.transactionId}>
                        <td className="date-cell">{formatDisplayDate(row.date)}</td>
                        <td>{row.description}</td>
                        <td>{accountNames.get(row.accountId) ?? "Account"}</td>
                        <td className="amount-col">{formatMoney(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ModalShell>
      )}
    </div>
  );
}
