import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { LEDGER_QA_EXAMPLES } from "./ledgerQa";
import { ModalShell } from "./Modal";
import { formatDisplayDate } from "./format";
import { formatMoney } from "./askVault/money";
import { useAskVault, type LegacyAnswer } from "./askVault/useAskVault";
import type { Correction, Interpretation, ParseContext } from "./askVault/types";
import type { createFinancialClient } from "./financialReads";

/** Questions shown as one-click suggestions when something could not be understood. */
const SUGGESTIONS = [
  "how much did I spend on groceries last month",
  "top 3 spending categories this year",
  "my three biggest expenses last month",
  "groceries last month without Costco",
];
export const MORE_EXAMPLES = ["how much did I spend at Costco last month", "everything except rent last month"];

/** The short phrases under the question that say what was understood, so a wrong reading is easy to spot. */
function understoodChips(i: Interpretation): string[] {
  const chips: string[] = [];
  if (i.kind === "rank-categories") chips.push(i.limit === 1 ? "Biggest category" : `Top ${i.limit} categories`);
  if (i.kind === "rank-purchases") chips.push(i.limit === 1 ? "Biggest purchase" : `Top ${i.limit} purchases`);
  if (i.kind === "compare") chips.push("Comparison");
  if (i.vendors.length) chips.push(`At ${i.vendors.join(", ")}`);
  if (i.category) chips.push(i.category);
  if (i.accountName) chips.push(`On ${i.accountName}`);
  if (!i.vendors.length && !i.category && !i.accountName && i.kind !== "rank-categories") chips.push("All spending");
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

/**
 * The Dashboard's "Ask the Vault" card. Spending questions are read exactly from the profile's own data
 * by the native side; the older question families are answered by the older matcher. Nothing leaves the
 * computer, and nothing is shown after the profile is locked or switched.
 */
export function AskVaultCard({
  getContext,
  legacyAsk,
  dataKey,
  accountNames,
  onOpenTransactions,
  createClient,
}: {
  getContext: () => ParseContext;
  legacyAsk: (question: string) => LegacyAnswer;
  /** Changes when the ledger changes; an answer on screen is retired when it does. */
  dataKey: unknown;
  accountNames: Map<number, string>;
  /** Opens the Transactions tab filtered the same way as an answer; offered only when it can show exactly those purchases. */
  onOpenTransactions?: (filter: { category: string; accountIds: number[]; from: string; to: string }) => void;
  createClient?: () => Pick<ReturnType<typeof createFinancialClient>, "askVault" | "dispose">;
}) {
  const { view, details, ask, openDetails, closeDetails } = useAskVault({ getContext, legacyAsk, dataKey, createClient });
  const [question, setQuestion] = useState("");
  const [showExamples, setShowExamples] = useState(false);
  const [placeholderExample] = useState(() => LEDGER_QA_EXAMPLES[Math.floor(Math.random() * LEDGER_QA_EXAMPLES.length)]);
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
      request.periods.length === 1;
    return exact ? { category: request.categories[0], accountIds: request.accountIds, from: request.periods[0].from, to: request.periods[0].to } : null;
  })();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    void ask(question);
  }
  function choose(next: string) {
    setQuestion(next);
    void ask(next);
  }

  return (
    <div className="card ledger-qa-card">
      <div className="card-head">
        <span className="reports-section-title cell-with-icon">
          <MessageCircleQuestion className="category-legend-icon" />
          Ask the Vault
        </span>
        <button type="button" className="modal-secondary" onClick={() => setShowExamples((v) => !v)}>
          {showExamples ? "Hide tips" : "Tips & examples"}
        </button>
      </div>
      {showExamples && (
        <div className="ledger-qa-tips">
          <p className="field-hint">
            Ask one thing at a time, using the category, account or store names you see elsewhere in the app. Add a time
            period like "this month," "last week," "July," "2026" or "the past 3 months." You can ask for a total, a top 3,
            or a comparison of two periods, name several stores ("at Meijer and Target"), or leave things out ("without
            Costco," "except rent").
          </p>
          <ul className="ledger-qa-examples">
            {[...LEDGER_QA_EXAMPLES, ...MORE_EXAMPLES].map((example) => (
              <li key={example}>
                <button type="button" onClick={() => setQuestion(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form className="category-create-form" onSubmit={submit}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`e.g. "${placeholderExample}"`} aria-label="Your question" />
        <button type="submit" disabled={!question.trim()}>
          Ask
        </button>
      </form>
      <div className="ledger-qa-result" aria-live="polite">
        {view.status === "loading" && <p className="ledger-qa-working">Looking that up…</p>}

        {view.status === "answer" && (
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
              {view.result.answer.rows.length > 0 && (
                <ol className="ledger-qa-rows">
                  {view.result.answer.rows.map((row, i) => (
                    <li key={`${row.label}-${i}`}>
                      <span>{row.label}</span>
                      <span className="ledger-qa-amount">{row.amount}</span>
                      <span className="ledger-qa-sub">{row.detail}</span>
                    </li>
                  ))}
                </ol>
              )}
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
                {view.choices.map((choice, i) => (
                  <button key={choice} type="button" onClick={() => choose(view.replacements![i])}>
                    {choice}
                  </button>
                ))}
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
            <strong>That answer is no longer shown.</strong> {view.message}{" "}
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
          {details.status === "loading" && <p>Loading purchases…</p>}
          {details.status === "error" && <p role="alert">{details.message}</p>}
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
