import "./StatementReconcile.css";
import { useEffect, useMemo, useState } from "react";
import { ModalShell } from "./Modal";
import type { AccountKind, StatementLineText, TeachMarks, TextRef } from "./statementContracts";

export const MAX_ATTEMPTS = 3;

type StepId = "date" | "amount" | "balance_kind" | "start" | "end" | "symbol" | "quantity" | "price" | "value" | "total";
type BalanceKind = "start_end" | "totals" | "none";

const PROMPTS: Record<StepId, string> = {
  date: "Click the date of one transaction.",
  amount: "Click that transaction's amount.",
  balance_kind: "What does this statement show for the account's money?",
  start: "Click the starting balance.",
  end: "Click the ending balance.",
  symbol: "Click the symbol of one holding.",
  quantity: "Click its number of shares.",
  price: "Click its price.",
  value: "Click its value.",
  total: "Click the total value of all holdings.",
};

export function steps(kind: AccountKind, needs: { rows: boolean; holdings: boolean }, balanceKind: BalanceKind | null): StepId[] {
  const out: StepId[] = [];
  if (needs.rows) {
    out.push("date", "amount");
    if (kind === "investment") out.push("balance_kind");
    if (kind !== "investment" || (balanceKind !== null && balanceKind !== "none")) out.push("start", "end");
  }
  if (needs.holdings) out.push("symbol", "quantity", "price", "value", "total");
  return out;
}

function words(text: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = [];
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) { i++; continue; }
    const start = i;
    while (i < chars.length && !/\s/.test(chars[i])) i++;
    out.push({ word: chars.slice(start, i).join(""), start });
  }
  return out;
}

export function StatementTeachDialog(props: {
  lines: StatementLineText[]; kind: AccountKind; attempts: number; busy: boolean; error: string | null;
  needs: { rows: boolean; holdings: boolean };
  onTeach: (marks: TeachMarks) => void; onBack: () => void; onGiveUp: () => void;
}) {
  const [balanceKind, setBalanceKind] = useState<BalanceKind | null>(props.kind === "investment" ? null : "start_end");
  const [marks, setMarks] = useState<Partial<Record<StepId, TextRef | null>>>({});
  const order = steps(props.kind, props.needs, balanceKind);
  const current = order.find((s) => !(s in marks) && !(s === "balance_kind" && balanceKind !== null));
  // After a try that didn't add up, start over the kinds still needed; marks for the kinds that already
  // worked are kept and sent again with the next try.
  const needsRows = props.needs.rows;
  const needsHoldings = props.needs.holdings;
  useEffect(() => {
    if (props.attempts === 0) return;
    const again = new Set(steps(props.kind, { rows: needsRows, holdings: needsHoldings }, balanceKind));
    setMarks((prev) => Object.fromEntries(Object.entries(prev).filter(([step]) => !again.has(step as StepId))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.attempts]);
  const exhausted = props.attempts >= MAX_ATTEMPTS;
  const marked = useMemo(() => new Set(Object.values(marks).filter(Boolean).map((r) => `${r!.line}:${r!.start}`)), [marks]);

  function click(ref: TextRef) {
    if (!current || current === "balance_kind") return;
    setMarks((m) => ({ ...m, [current]: ref }));
  }

  function undo() {
    const done = order.filter((s) => s in marks);
    const last = done[done.length - 1];
    if (!last) return;
    setMarks((m) => { const n = { ...m }; delete n[last]; return n; });
  }

  function submit() {
    const m = marks;
    const result: TeachMarks = { rows: [], balances: null, holdings: [] };
    if (m.date && m.amount) result.rows.push({ date: m.date, amount: m.amount });
    if (m.start && m.end) {
      result.balances = balanceKind === "totals" ? { kind: "totals", additions: m.start, subtractions: m.end } : { kind: "start_end", start: m.start, end: m.end };
    }
    if (m.symbol && m.quantity && m.value && m.total) {
      result.holdings.push({ symbol: m.symbol, quantity: m.quantity, price: m.price ?? null, marketValue: m.value, total: m.total });
    }
    props.onTeach(result);
  }

  const footer = (
    <div className="statement-footer">
      <button type="button" className="modal-secondary" onClick={props.onBack} disabled={props.busy}>Back</button>
      {exhausted ? (
        <button type="button" onClick={props.onGiveUp} data-teach-give-up>Use another way</button>
      ) : (<>
        <button type="button" className="modal-secondary" onClick={undo} disabled={props.busy} data-undo-mark>Undo last click</button>
        <button type="button" onClick={submit} disabled={props.busy || current !== undefined} data-teach-submit>Check my examples</button>
      </>)}
    </div>
  );

  const prompt = current === "start" && balanceKind === "totals" ? "Click the total of money added." : current === "end" && balanceKind === "totals" ? "Click the total of money taken out." : current ? PROMPTS[current] : "That's everything. Check your examples.";

  return (
    <ModalShell title="Teach the app how to read this statement" onCancel={props.onBack} wide dismissOnOverlayClick={false} footer={footer}>
      <div className="statement-review" data-statement-teach>
        {props.error && <p className="statement-error" role="alert">{props.error}</p>}
        {exhausted ? (
          <p className="statement-banner">The app still can't read this statement. You can use your bank's CSV or OFX download, or reconcile by hand.</p>
        ) : (<>
          {props.attempts > 0 && <p className="statement-banner">That still doesn't add up. Show the app one more example.</p>}
          <p data-teach-prompt><strong>{prompt}</strong></p>
          {current === "balance_kind" && (
            <div className="statement-banner-actions">
              <button type="button" onClick={() => setBalanceKind("totals")} data-balance-kind="totals">This statement shows totals of money added and taken out</button>
              <button type="button" onClick={() => setBalanceKind("start_end")} data-balance-kind="start_end">This statement shows a cash balance at the start and end</button>
              <button type="button" className="modal-secondary" onClick={() => setBalanceKind("none")} data-balance-kind="none">This statement shows neither</button>
            </div>
          )}
          {(current === "start") && props.kind !== "investment" && (
            <button type="button" className="modal-secondary" onClick={() => setMarks((m) => ({ ...m, start: null, end: null }))} data-no-balances>This statement doesn't show these</button>
          )}
          {current === "price" && <button type="button" className="modal-secondary" onClick={() => setMarks((m) => ({ ...m, price: null }))}>It has no price</button>}
        </>)}
        <div className="statement-teach-lines">
          {props.lines.map((l) => (
            <div key={l.index} className="statement-teach-line">
              {words(l.text).map((w) => (
                <button key={w.start} type="button" className="statement-teach-word" data-line={l.index} data-start={w.start}
                  data-marked={marked.has(`${l.index}:${w.start}`) ? "" : undefined} disabled={exhausted || props.busy}
                  onClick={() => click({ line: l.index, start: w.start })}>{w.word}</button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
