import "./StatementReconcile.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ModalShell } from "./Modal";
import { formatAmount, formatDisplayDate, isValidDecimalString } from "./format";
import { addAmounts, changeFor, isZero, statementDifference, toUnits } from "./reconcileMath";
import type { AppTransaction, FinishDecisions, HoldingReview, ReviewRow, StatementReview } from "./statementContracts";

export type RowChoice = { kind: "match"; transactionId: number } | { kind: "add"; description: string } | { kind: "skip" };
export type HoldingChoice = { action: "update" | "add" | "remove" | "leave"; costBasis?: string };
export type FinishState = {
  choices: Map<number, RowChoice>;
  start: string;
  end: string;
  /** Statement holdings by symbol; holdings only in the app by `app:{id}`. */
  holdings: Map<string, HoldingChoice>;
  finishWithoutHoldings: boolean;
  ignoreUnread?: boolean;
  remember?: { on: boolean; name: string; phrases: string[] };
};
export type FinishCheck = { ok: boolean; reason: string | null; difference: string | null };

/** An amount the screen can add up exactly, or null when it isn't one (blank, "1e3", "1,000", more
 * than four decimal places). */
function units(s: string): bigint | null {
  if (!isValidDecimalString(s)) return null;
  try {
    return toUnits(s);
  } catch {
    return null;
  }
}

/** A loan line whose statement prints a separate part that pays down the loan (not the whole amount). */
function paysDownPart(review: StatementReview, row: ReviewRow): string | null {
  if (review.account_kind !== "loan" || row.principal === null) return null;
  return units(row.principal) === units(row.amount) ? null : row.principal;
}

/** Lines dated on or before an earlier reconciliation can't be added again. */
function addable(review: StatementReview, row: ReviewRow): boolean {
  return !review.already_reconciled_through || row.date > review.already_reconciled_through;
}

export function initialChoices(review: StatementReview): Map<number, RowChoice> {
  const choices = new Map<number, RowChoice>();
  for (const row of review.rows) {
    if (row.status === "matched" && row.match_id !== null) choices.set(row.index, { kind: "match", transactionId: row.match_id });
    else if (row.status === "missing" && !review.already_reconciled_through) choices.set(row.index, { kind: "add", description: row.description });
  }
  return choices;
}

/** How share counts are handled: checked against the statement, impossible to check (the person must
 * say they finish without checking them), or nothing to check at all. Mirrors the app's own rule. */
export function holdingsMode(review: StatementReview): "check" | "cannot_check" | "none" {
  if (review.holdings_check.outcome === "passed") return "check";
  const nothing = review.holdings_check.outcome === "not_available" && review.holdings.length === 0 && review.app_only_holdings.length === 0;
  return nothing ? "none" : "cannot_check";
}

/** A plain decimal ("-12.345") as an exact integer and its number of decimal places. */
function parseExact(s: string): { v: bigint; scale: number } {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`Not a number: ${s}`);
  const frac = m[3] ?? "";
  const v = BigInt(m[2] + frac);
  return { v: m[1] ? -v : v, scale: frac.length };
}

const atScale = (x: { v: bigint; scale: number }, scale: number) => x.v * 10n ** BigInt(scale - x.scale);

/** a + b exactly, however many decimal places (share counts can have more than money's four). */
function addExact(a: string, b: string): string {
  const x = parseExact(a);
  const y = parseExact(b);
  const scale = Math.max(x.scale, y.scale);
  const sum = atScale(x, scale) + atScale(y, scale);
  const abs = sum < 0n ? -sum : sum;
  const unit = 10n ** BigInt(scale);
  const frac = scale === 0 ? "" : (abs % unit).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${sum < 0n ? "-" : ""}${abs / unit}${frac ? `.${frac}` : ""}`;
}

function sameExact(a: string, b: string): boolean {
  const x = parseExact(a);
  const y = parseExact(b);
  const scale = Math.max(x.scale, y.scale);
  return atScale(x, scale) === atScale(y, scale);
}

const symbolKey = (s: string) => s.trim().toUpperCase();

/** The statement's holdings with any symbol listed more than once (in two tables, say) folded into one
 * with its shares added together. The app checks share counts per symbol and takes one change per
 * symbol, so the screen shows and sends one. */
export function foldHoldings(holdings: HoldingReview[]): HoldingReview[] {
  const groups = new Map<string, HoldingReview[]>();
  for (const h of holdings) groups.set(symbolKey(h.symbol), [...(groups.get(symbolKey(h.symbol)) ?? []), h]);
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const first = group[0];
    const shares = group.slice(1).reduce((sum, h) => addExact(sum, h.statement_shares), first.statement_shares);
    const appShares = group.find((h) => h.app_shares !== null)?.app_shares ?? null;
    return {
      symbol: first.symbol.trim(),
      name: group.find((h) => h.name.trim())?.name ?? "",
      statement_shares: shares,
      price: group.find((h) => h.price !== null)?.price ?? null,
      market_value: addAmounts(group.map((h) => h.market_value)),
      app_holding_id: group.find((h) => h.app_holding_id !== null)?.app_holding_id ?? null,
      app_shares: appShares,
      status: appShares === null ? "missing_in_app" : sameExact(appShares, shares) ? "same" : "different",
    };
  });
}

function initialHoldings(review: StatementReview): Map<string, HoldingChoice> {
  const out = new Map<string, HoldingChoice>();
  for (const h of foldHoldings(review.holdings)) {
    out.set(h.symbol, h.status === "different" ? { action: "update" } : h.status === "missing_in_app" ? { action: "add", costBasis: "" } : { action: "leave" });
  }
  for (const h of review.app_only_holdings) out.set(`app:${h.id}`, { action: "leave" });
  return out;
}

/** How a chosen line moves the statement balance, the same way the app counts it when finishing: a
 * matched loan payment whose statement prints a pays-down part counts by that part. */
function lineChange(review: StatementReview, row: ReviewRow, choice: RowChoice, byId: Map<number, AppTransaction>): string | null {
  if (choice.kind === "skip") return null;
  const part = paysDownPart(review, row);
  if (choice.kind === "add") return changeFor(review.account_kind, row.amount, part);
  if (part !== null) return changeFor(review.account_kind, row.amount, part);
  return byId.get(choice.transactionId)?.change ?? null;
}

const UNTICK_REMEMBER = "or untick “Remember this statement”.";

export function canFinish(review: StatementReview, s: FinishState): FinishCheck {
  const investment = review.account_kind === "investment";
  const byId = new Map(review.app_transactions.map((t) => [t.id, t]));

  let difference: string | null = null;
  let balanceProblem: string | null = null;
  if (!investment) {
    const start = review.previous_ending_balance ?? s.start;
    if (!start.trim() || !s.end.trim()) balanceProblem = "Enter the balances from your statement.";
    else if (units(start) === null || units(s.end) === null) balanceProblem = "Enter the balances as plain amounts, like 1234.56.";
    else {
      const changes = review.rows.flatMap((r) => {
        const c = s.choices.get(r.index);
        const change = c ? lineChange(review, r, c, byId) : null;
        return change === null ? [] : [change];
      });
      difference = statementDifference(s.end, start, changes);
    }
  }
  const fail = (reason: string): FinishCheck => ({ ok: false, reason, difference });

  if (review.rows.some((r) => !s.choices.has(r.index))) return fail("Choose what to do with every line on your statement.");
  const used = [...s.choices.values()].flatMap((c) => (c.kind === "match" ? [c.transactionId] : []));
  if (new Set(used).size !== used.length) return fail("One of your transactions is matched to two lines.");
  if (used.some((id) => !byId.has(id))) return fail("A transaction you matched isn't in the app anymore. Choose its match again.");
  if ([...s.choices.values()].some((c) => c.kind === "add" && !c.description.trim())) return fail("Every transaction you add needs a description.");

  if (investment) {
    const mode = holdingsMode(review);
    if (mode === "cannot_check" && !s.finishWithoutHoldings) {
      return fail(
        review.holdings_check.outcome === "failed"
          ? `The app couldn't read your holdings correctly. ${review.source === "pdf" ? "Teach it how to read them, or tick" : "Tick"} “Finish without checking holdings”.`
          : "Your statement doesn't show a total for your holdings, so share counts can't be checked. Tick “Finish without checking holdings”, then update share counts in Investments.",
      );
    }
    if (mode === "check") {
      for (const h of foldHoldings(review.holdings)) {
        const c = s.holdings.get(h.symbol);
        if (h.status === "different" && c?.action !== "update") return fail(`Update ${h.symbol} to match your statement first.`);
        if (h.status === "missing_in_app") {
          if (c?.action !== "add") return fail(`Add ${h.symbol} with what you paid for it first.`);
          const paid = units(c.costBasis ?? "");
          if (paid === null || paid < 0n) return fail(`Enter what you paid in total for ${h.symbol}.`);
        }
      }
    }
  } else {
    if (balanceProblem) return fail(balanceProblem);
    if (difference === null || !isZero(difference)) return fail("The difference has to be $0.00.");
  }

  if (review.learnable && s.remember?.on) {
    if (!s.remember.name.trim()) return fail(`Give this statement a name so the app can remember it, ${UNTICK_REMEMBER}`);
    if (s.remember.phrases.length === 0) return fail(`Choose at least one phrase to recognize it by, ${UNTICK_REMEMBER}`);
    if (review.unread.length > 0 && !s.ignoreUnread) return fail(`Tick “Ignore the lines the app couldn't read” to remember this statement, ${UNTICK_REMEMBER}`);
  }
  return { ok: true, reason: null, difference };
}

function balanceWords(kind: StatementReview["account_kind"]) {
  if (kind === "credit") return { start: "Amount owed at the start", end: "Amount owed at the end" };
  if (kind === "loan") return { start: "Amount you owed on the loan at the start", end: "Amount you owed on the loan at the end" };
  return { start: "Starting balance", end: "Ending balance" };
}

/** Like `formatAmount`, but a difference of a fraction of a cent still shows (it still blocks Finish). */
function formatExact(s: string): string {
  if (toUnits(s) % 100n === 0n) return formatAmount(s);
  const n = Number(s);
  const digits = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n < 0 ? `-$${digits}` : `$${digits}`;
}

type Form = {
  token: string;
  choices: Map<number, RowChoice>;
  start: string;
  end: string;
  holdings: Map<string, HoldingChoice>;
  finishWithoutHoldings: boolean;
  ignoreUnread: boolean;
  remember: boolean;
  name: string;
  phrases: string[];
};

function initialForm(review: StatementReview): Form {
  return {
    token: review.token,
    choices: initialChoices(review),
    start: review.starting_balance ?? "",
    end: review.ending_balance ?? "",
    holdings: initialHoldings(review),
    finishWithoutHoldings: false,
    ignoreUnread: false,
    // Remembering needs every line read (or ignored), so it starts off when some couldn't be.
    remember: review.learnable && review.suggested_phrases.length > 0 && review.unread.length === 0,
    name: review.suggested_name,
    phrases: review.suggested_phrases.slice(0, 1),
  };
}

/** A choice button: pressed when it is the current choice. */
function Choice(props: { pressed: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  const { pressed, onClick, disabled, children, ...data } = props;
  return (
    <button type="button" className={pressed ? "statement-choice-on" : "modal-secondary"} aria-pressed={pressed} onClick={onClick} disabled={disabled} {...data}>
      {children}
    </button>
  );
}

export function StatementReviewDialog(props: {
  review: StatementReview;
  accountName: string;
  busy: boolean;
  error: string | null;
  onFlip: (flip: boolean) => void;
  onTeach: () => void;
  onUseDownload: () => void;
  onReconcileByHand: () => void;
  onFinish: (d: FinishDecisions) => void;
  onCancel: () => void;
}) {
  const { review, busy } = props;
  const [stored, setForm] = useState<Form>(() => initialForm(review));
  // A new review (after a flip or teaching) starts the choices over.
  let form = stored;
  if (stored.token !== review.token) {
    form = initialForm(review);
    setForm(form);
  }
  const update = (fn: (f: Form) => Partial<Form>) => setForm((old) => ({ ...old, ...fn(old) }));
  const setChoice = (index: number, c: RowChoice | null) =>
    update((f) => {
      const choices = new Map(f.choices);
      if (c) choices.set(index, c);
      else choices.delete(index);
      return { choices };
    });
  const setHolding = (key: string, c: HoldingChoice) => update((f) => ({ holdings: new Map(f.holdings).set(key, c) }));

  const byId = useMemo(() => new Map(review.app_transactions.map((t) => [t.id, t])), [review]);
  const investment = review.account_kind === "investment";
  const mode = investment ? holdingsMode(review) : "none";
  const status = canFinish(review, {
    choices: form.choices,
    start: form.start,
    end: form.end,
    holdings: form.holdings,
    finishWithoutHoldings: form.finishWithoutHoldings,
    ignoreUnread: form.ignoreUnread,
    remember: { on: form.remember, name: form.name, phrases: form.phrases },
  });
  const words = balanceWords(review.account_kind);
  const needsHelp = review.activity_check.outcome === "failed" || review.recognized_but_failed;
  const canTeach = review.source === "pdf";
  const showRemember = review.learnable && review.suggested_phrases.length > 0;
  const reasonId = useId();
  const holdings = useMemo(() => foldHoldings(review.holdings), [review]);
  // The app refuses share-count changes when the statement lists no holdings, so none are offered then.
  const canRemoveHoldings = mode === "check" && holdings.length > 0;
  const earlierRows = review.rows.filter((r) => !addable(review, r));
  const earlierUndecided = earlierRows.filter((r) => !form.choices.has(r.index));

  // What stays unticked as things stand: every app transaction no line is matched to, except the
  // possible matches of lines still being decided.
  const chosenIds = new Set([...form.choices.values()].flatMap((c) => (c.kind === "match" ? [c.transactionId] : [])));
  const pendingIds = new Set(review.rows.filter((r) => !form.choices.has(r.index)).flatMap((r) => [...(r.match_id !== null ? [r.match_id] : []), ...r.possible_ids]));
  const notOnStatement = review.app_transactions.filter((t) => !chosenIds.has(t.id) && !pendingIds.has(t.id));

  // When the button just pressed goes away (Not a match, or picking a line's own match back), keyboard
  // focus moves to the row's first control instead of falling back to the page.
  const reviewRef = useRef<HTMLDivElement>(null);
  const focusRow = useRef<number | null>(null);
  useEffect(() => {
    if (focusRow.current === null) return;
    const cell = reviewRef.current?.querySelector(`[data-statement-row="${focusRow.current}"] [data-row-choices]`);
    focusRow.current = null;
    cell?.querySelector<HTMLElement>("button, input")?.focus();
  });

  function submit() {
    if (!status.ok || busy) return;
    const d: FinishDecisions = {
      matches: [],
      add: [],
      skip: [],
      startingBalance: investment || review.previous_ending_balance !== null ? null : form.start.trim(),
      endingBalance: investment ? null : form.end.trim(),
      holdings: [],
      finishWithoutHoldings: mode === "cannot_check" && form.finishWithoutHoldings,
      ignoreUnread: form.ignoreUnread,
      saveLayout: showRemember && form.remember ? { name: form.name.trim(), phrases: form.phrases } : null,
    };
    for (const r of review.rows) {
      const c = form.choices.get(r.index)!;
      if (c.kind === "match") d.matches.push({ row: r.index, transactionId: c.transactionId });
      else if (c.kind === "add") d.add.push({ row: r.index, date: r.date, description: c.description.trim(), amount: r.amount });
      else d.skip.push(r.index);
    }
    // Share counts change only when they were checked against the statement.
    if (mode === "check") {
      for (const h of holdings) {
        const c = form.holdings.get(h.symbol) ?? { action: "leave" };
        d.holdings.push({
          symbol: h.symbol,
          action: c.action,
          holdingId: h.app_holding_id,
          shares: h.statement_shares,
          price: h.price,
          costBasis: c.action === "add" ? (c.costBasis ?? "").trim() : null,
          name: h.name || h.symbol,
        });
      }
      for (const h of review.app_only_holdings) {
        const c = form.holdings.get(`app:${h.id}`) ?? { action: "leave" };
        const action = canRemoveHoldings ? c.action : "leave";
        d.holdings.push({ symbol: h.symbol, action, holdingId: h.id, shares: null, price: null, costBasis: null, name: h.name });
      }
    }
    props.onFinish(d);
  }

  const balanced = status.difference !== null && isZero(status.difference);
  const footer = (
    <div className="statement-footer">
      {!investment && (
        <span className="statement-difference" aria-live="polite">
          <span className="reconcile-label">Difference</span>{" "}
          <span className={balanced ? "reconcile-figure reconcile-balanced" : "reconcile-figure reconcile-off"} data-difference data-balanced={balanced ? "true" : "false"}>
            {status.difference !== null ? formatExact(status.difference) : "—"}
          </span>
        </span>
      )}
      {status.reason && (
        <span className="modal-message-secondary statement-reason" id={reasonId} data-finish-reason>
          {status.reason}
        </span>
      )}
      <span className="statement-footer-actions">
        <button type="button" className="modal-secondary" onClick={props.onCancel} disabled={busy} data-statement-not-now>
          Not now
        </button>
        <button type="button" onClick={submit} disabled={!status.ok || busy} aria-describedby={status.reason ? reasonId : undefined} data-statement-finish>
          {busy ? "Working…" : "Finish reconciliation"}
        </button>
      </span>
    </div>
  );

  const period = `${formatDisplayDate(review.period_start)} – ${formatDisplayDate(review.period_end)}`;

  return (
    <ModalShell
      title={`Reconcile ${props.accountName}`}
      onCancel={() => {
        if (!busy) props.onCancel();
      }}
      wide
      dismissOnOverlayClick={false}
      footer={footer}
    >
      <div className="statement-review" ref={reviewRef} data-statement-review>
        <p className="modal-message-secondary statement-heading">
          {review.section_name} · {period}
          {review.recognized && review.layout_name ? ` · Read using: ${review.layout_name}` : ""}
        </p>
        {props.error && (
          <p className="field-error statement-error" role="alert">
            {props.error}
          </p>
        )}

        {needsHelp && (
          <div className="statement-banner statement-banner-warning" data-needs-help>
            <p>{review.recognized_but_failed ? "This bank's statements look different from last time." : "Some of this statement couldn't be read."}</p>
            <div className="statement-banner-actions">
              {canTeach && (
                <button type="button" onClick={props.onTeach} disabled={busy} data-teach>
                  Teach the app how to read this statement
                </button>
              )}
              <button type="button" className="modal-secondary" onClick={props.onUseDownload} disabled={busy} data-use-download>
                Use your bank's CSV or OFX download instead
              </button>
              <button type="button" className="modal-secondary" onClick={props.onReconcileByHand} disabled={busy} data-reconcile-by-hand>
                Reconcile by hand
              </button>
            </div>
            <p className="modal-message-secondary">Or keep going and check each line below yourself.</p>
          </div>
        )}
        {review.nothing_in_period && (
          <p className="statement-banner" data-nothing-in-period>
            No transactions were found between {formatDisplayDate(review.period_start)} and {formatDisplayDate(review.period_end)}. Check the dates, or make sure
            this is the statement for {props.accountName}.
          </p>
        )}
        {review.already_reconciled_through && (
          <div className="statement-banner" data-already-reconciled>
            <p>
              You already reconciled this account through {formatDisplayDate(review.already_reconciled_through)}. Lines from before then are not offered for
              adding.
            </p>
            {earlierUndecided.length > 0 && (
              <button
                type="button"
                className="modal-secondary"
                onClick={() =>
                  update((f) => {
                    const choices = new Map(f.choices);
                    for (const r of earlierRows) if (!choices.has(r.index)) choices.set(r.index, { kind: "skip" });
                    return { choices };
                  })
                }
                data-skip-earlier
              >
                Skip all of these
              </button>
            )}
          </div>
        )}
        {review.suggest_flip && !review.flipped && (
          <div className="statement-banner statement-banner-actions" data-suggest-flip>
            <span>The amounts look reversed compared with your transactions.</span>
            <button type="button" onClick={() => props.onFlip(true)} disabled={busy} data-flip>
              Flip them
            </button>
          </div>
        )}
        {review.flipped && (
          <div className="statement-banner-actions modal-message-secondary" data-flipped>
            <span>Amounts flipped.</span>
            <button type="button" className="modal-secondary" onClick={() => props.onFlip(false)} disabled={busy} data-unflip>
              Undo
            </button>
          </div>
        )}

        {!investment && (
          <div className="statement-balances">
            {review.previous_ending_balance === null ? (
              <label className="labeled-field">
                <span className="labeled-field-label">{words.start}</span>
                <input
                  value={form.start}
                  onChange={(e) => update(() => ({ start: e.target.value }))}
                  placeholder="0.00"
                  inputMode="decimal"
                  data-statement-review-start
                />
              </label>
            ) : (
              <p className="modal-message-secondary">Picks up from your last reconciliation ({formatAmount(review.previous_ending_balance)}).</p>
            )}
            <label className="labeled-field">
              <span className="labeled-field-label">{words.end}</span>
              <input
                value={form.end}
                onChange={(e) => update(() => ({ end: e.target.value }))}
                placeholder="0.00"
                inputMode="decimal"
                data-statement-review-end
              />
            </label>
          </div>
        )}

        {review.rows.length > 0 && (
          <div className="modal-table-scroll">
            <table className="ledger statement-rows">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>On your statement</th>
                  <th className="amount-col">Amount</th>
                  <th>In the app</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((r) => {
                  const c = form.choices.get(r.index);
                  const part = paysDownPart(review, r);
                  const autoMatched = c?.kind === "match" && r.status === "matched" && c.transactionId === r.match_id ? byId.get(c.transactionId) : undefined;
                  const candidates = [...new Set([...(r.match_id !== null ? [r.match_id] : []), ...r.possible_ids])];
                  return (
                    <tr key={r.index} data-statement-row={r.index} data-choice={c?.kind ?? "none"}>
                      <td className="date-cell">{formatDisplayDate(r.date)}</td>
                      <td>
                        {r.description}
                        {part !== null && (
                          <span className="field-hint statement-row-note" data-pays-down>
                            {formatAmount(part)} of this is the part that pays down what you owe.
                          </span>
                        )}
                      </td>
                      <td className="amount-col">{formatAmount(r.amount)}</td>
                      <td data-row-choices>
                        {autoMatched ? (
                          <span className="statement-choices">
                            <span>
                              Matches “{autoMatched.description}” on {formatDisplayDate(autoMatched.date)}
                            </span>
                            <button
                              type="button"
                              className="modal-secondary"
                              onClick={() => {
                                focusRow.current = r.index;
                                setChoice(r.index, null);
                              }}
                              aria-label={`Not a match: ${r.description}`}
                              data-not-a-match
                            >
                              Not a match
                            </button>
                          </span>
                        ) : (
                          <span className="statement-choices" role="group" aria-label={`What to do with ${r.description}`}>
                            {candidates.map((id) => {
                              const t = byId.get(id);
                              return t ? (
                                <Choice
                                  key={id}
                                  pressed={c?.kind === "match" && c.transactionId === id}
                                  onClick={() => {
                                    // Picking the line's own match back shows it as matched, without these buttons.
                                    if (r.status === "matched" && id === r.match_id) focusRow.current = r.index;
                                    setChoice(r.index, { kind: "match", transactionId: id });
                                  }}
                                  data-same-as={id}
                                >
                                  Same as “{t.description}” on {formatDisplayDate(t.date)}
                                </Choice>
                              ) : null;
                            })}
                            {addable(review, r) && (
                              <Choice
                                pressed={c?.kind === "add"}
                                onClick={() => setChoice(r.index, { kind: "add", description: c?.kind === "add" ? c.description : r.description })}
                                data-add-row
                              >
                                Add it
                              </Choice>
                            )}
                            <Choice pressed={c?.kind === "skip"} onClick={() => setChoice(r.index, { kind: "skip" })} data-skip-row>
                              Skip
                            </Choice>
                            {c?.kind === "add" && (
                              <input
                                className="statement-add-description"
                                aria-label={`Description for the new transaction “${r.description}”`}
                                value={c.description}
                                onChange={(e) => setChoice(r.index, { kind: "add", description: e.target.value })}
                                data-add-description
                              />
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {notOnStatement.length > 0 && (
          <div className="statement-section" data-not-on-statement>
            <h3>In the app, not on your statement</h3>
            <p className="modal-message-secondary">These stay unticked. They may appear on next month's statement, or they may be duplicates.</p>
            <ul>
              {notOnStatement.map((t) => (
                <li key={t.id}>
                  {formatDisplayDate(t.date)} · {t.description} · {formatAmount(t.amount)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {review.unread.length > 0 && (
          <div className="statement-section" data-unread>
            <h3>Lines the app couldn't read</h3>
            <ul className="statement-unread-lines">
              {review.unread.map((u) => (
                <li key={u.line}>{u.text}</li>
              ))}
            </ul>
            <label className="statement-check">
              <input type="checkbox" checked={form.ignoreUnread} onChange={(e) => update(() => ({ ignoreUnread: e.target.checked }))} data-ignore-unread />
              Ignore the lines the app couldn't read
            </label>
          </div>
        )}

        {investment && mode !== "none" && (
          <div className="statement-section" data-holdings>
            <h3>Share counts</h3>
            {mode === "cannot_check" && (
              <div className="statement-banner statement-banner-warning">
                {review.holdings_check.outcome === "failed" ? (
                  <p>The app couldn't read your holdings correctly.</p>
                ) : (
                  <p>
                    Your statement doesn't show a total for your holdings, so the app can't check your share counts against it. You can finish without checking
                    holdings, then update share counts in Investments.
                  </p>
                )}
                <div className="statement-banner-actions">
                  {review.holdings_check.outcome === "failed" && canTeach && (
                    <button type="button" onClick={props.onTeach} disabled={busy} data-teach-holdings>
                      Teach the app how to read your holdings
                    </button>
                  )}
                  <label className="statement-check">
                    <input
                      type="checkbox"
                      checked={form.finishWithoutHoldings}
                      onChange={(e) => update(() => ({ finishWithoutHoldings: e.target.checked }))}
                      data-finish-without-holdings
                    />
                    Finish without checking holdings
                  </label>
                </div>
              </div>
            )}
            {mode === "check" && !canRemoveHoldings && review.app_only_holdings.length > 0 && (
              <p className="modal-message-secondary" data-no-statement-holdings>
                Your statement doesn't list any holdings, so the app leaves the ones below as they are. You can change them in Investments.
              </p>
            )}
            {review.ending_value && (
              <p className="modal-message-secondary">
                Value on your statement: {formatAmount(review.ending_value)}. This is for your information only; it changes with the market.
              </p>
            )}
            <div className="modal-table-scroll">
              <table className="ledger statement-rows">
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th className="amount-col">On your statement</th>
                    <th className="amount-col">In the app</th>
                    {mode === "check" && <th>What to do</th>}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => {
                    const c = form.holdings.get(h.symbol) ?? { action: "leave" };
                    return (
                      <tr key={h.symbol} data-holding={h.symbol} data-holding-status={h.status}>
                        <td>
                          <strong>{h.symbol}</strong> {h.name}
                        </td>
                        <td className="amount-col">{h.statement_shares} shares</td>
                        <td className="amount-col">{h.app_shares !== null ? `${h.app_shares} shares` : "—"}</td>
                        {mode === "check" && (
                          <td>
                            <span className="statement-choices" role="group" aria-label={`What to do with ${h.symbol}`}>
                              {h.status === "same" && <span>Matches</span>}
                              {h.status === "different" && (
                                <>
                                  <Choice pressed={c.action === "update"} onClick={() => setHolding(h.symbol, { action: "update" })} data-update-holding>
                                    Update the app to {h.statement_shares} shares
                                  </Choice>
                                  <Choice pressed={c.action === "leave"} onClick={() => setHolding(h.symbol, { action: "leave" })} data-leave-holding>
                                    Leave it
                                  </Choice>
                                </>
                              )}
                              {h.status === "missing_in_app" && (
                                <>
                                  <Choice
                                    pressed={c.action === "add"}
                                    onClick={() => setHolding(h.symbol, { action: "add", costBasis: c.costBasis ?? "" })}
                                    data-add-holding
                                  >
                                    Add this holding
                                  </Choice>
                                  <Choice
                                    pressed={c.action === "leave"}
                                    onClick={() => setHolding(h.symbol, { action: "leave", costBasis: c.costBasis })}
                                    data-leave-holding
                                  >
                                    Leave it
                                  </Choice>
                                  {c.action === "add" && (
                                    <label className="labeled-field">
                                      <span className="labeled-field-label">What you paid in total</span>
                                      <input
                                        value={c.costBasis ?? ""}
                                        onChange={(e) => setHolding(h.symbol, { action: "add", costBasis: e.target.value })}
                                        placeholder="0.00"
                                        inputMode="decimal"
                                        aria-label={`What you paid in total for ${h.symbol}`}
                                        data-cost-basis
                                      />
                                    </label>
                                  )}
                                </>
                              )}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {review.app_only_holdings.map((h) => {
                    const key = `app:${h.id}`;
                    const c = form.holdings.get(key) ?? { action: "leave" };
                    return (
                      <tr key={key} data-app-only-holding={h.symbol}>
                        <td>
                          <strong>{h.symbol}</strong> {h.name}
                        </td>
                        <td className="amount-col">—</td>
                        <td className="amount-col">{h.shares} shares</td>
                        {mode === "check" && !canRemoveHoldings && <td>Left as it is</td>}
                        {canRemoveHoldings && (
                          <td>
                            <span className="statement-choices" role="group" aria-label={`What to do with ${h.symbol}`}>
                              <Choice pressed={c.action === "remove"} onClick={() => setHolding(key, { action: "remove" })} data-remove-holding>
                                Remove from the app
                              </Choice>
                              <Choice pressed={c.action === "leave"} onClick={() => setHolding(key, { action: "leave" })} data-leave-holding>
                                Leave it
                              </Choice>
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showRemember && (
          <div className="statement-section" data-remember>
            <label className="statement-check">
              <input type="checkbox" checked={form.remember} onChange={(e) => update(() => ({ remember: e.target.checked }))} data-remember-toggle />
              Remember this statement
            </label>
            <p className="modal-message-secondary">We'll recognize statements like this next time.</p>
            {review.unread.length > 0 && !form.ignoreUnread && (
              <p className="field-hint" data-remember-why-off>
                This starts off because some lines couldn't be read. To remember this statement, first tick “Ignore the lines the app couldn't read”.
              </p>
            )}
            {form.remember && (
              <>
                <label className="labeled-field">
                  <span className="labeled-field-label">Name</span>
                  <input value={form.name} onChange={(e) => update(() => ({ name: e.target.value }))} data-remember-name />
                </label>
                {review.suggested_phrases.map((p) => (
                  <label key={p} className="statement-check">
                    <input
                      type="checkbox"
                      checked={form.phrases.includes(p)}
                      onChange={(e) => update((f) => ({ phrases: e.target.checked ? [...f.phrases, p] : f.phrases.filter((x) => x !== p) }))}
                      data-remember-phrase
                    />
                    Recognize it by: “{p}”
                  </label>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
