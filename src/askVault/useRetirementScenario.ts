import { useEffect, useRef, useState } from "react";
import { traceRetire, traceReviewPublisher } from "./retirementStageTrace";
import { createFinancialClient } from "../financialReads";
import { onDataWrite } from "./dataWriteEvents";
import { compareRetirementRosterRows, retirementFreshness } from "./retirementNativeContract";
import { readRetirementContext, readRetirementRoster, retirementContextClient, retirementSourceFromRoster } from "./retirementContextReader";
import type { RetirementClient, RetirementReadResult } from "./retirementContextReader";
import { parseRetirementScenario } from "./retirementParser";
import { calculateRetirementScenario } from "./retirementScenarioMath";
import { validateConfirmedRetirementScenario } from "./retirementScenarioContract";
import type { ConfirmedRetirementScenario, RetirementContext, RetirementContextRead, RetirementDraft, RetirementParseContext, RetirementSource } from "./retirementScenarioContract";
import {
  RETIREMENT_CHANGED_MESSAGE, buildExploreConfirmation, buildRetirementReview, retirementCompleteEvent, retirementMonthUsable, retirementSavedMonthBeyondLimit, validateRetirementChoicesEvent, withRetirementMonth,
} from "./retirementScreenContract";
import type { RetirementChoicesEvent, RetirementReview, RetirementScreen, PreviewCalculation } from "./retirementScreenContract";
import type { AskClarification, AskDataRevision, ParseContext } from "./types";

type Owner = { data: unknown; reload: unknown; context: string };
type Phase = "roster" | "choices" | "reading" | "review" | "confirming" | "result" | "explore" | "other";
type Roster = { accounts: { id: number; name: string }[]; revision: AskDataRevision; source: RetirementSource };
type Read = RetirementContextRead;
type Shown = "deposits-only" | "blocked" | "result";
type Pending = {
  traceReview?: (screen: object) => void;
  question: string; owner: Owner; draft: RetirementDraft; phase: Phase; roster?: Roster;
  /** The last account read this flow accepted. Revalidation and the next step are bound to it. */
  read?: Read; review?: RetirementReview; calculation?: Extract<ReturnType<typeof calculateRetirementScenario>, { kind: "preview" | "extra-deposits-only" | "refused" }>;
  shown?: Shown; openReturnChoice?: boolean; checking?: boolean;
};
type View = { question: string; owner: Owner | null; screen: RetirementScreen | null; live: RetirementParseContext | null; clarification: AskClarification | null; openReturnChoice: boolean };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const INVALID = "Those choices no longer match the details you reviewed. Start again and confirm everything.";
const fingerprint = (context: ParseContext) => JSON.stringify([context.today, (context.investmentAccounts ?? []).map(({ id, name }) => [id, name])]);
/** Shown to nothing: a screen always arrives with its own live context. Rendering must not read the Dashboard (the card shows its first sign of life before any such work). */
const NO_LIVE: RetirementParseContext = { today: "2000-01-01", investmentAccounts: [] };
const dashboardAccounts = (context: ParseContext) => (context.investmentAccounts ?? []).map(({ id, name }) => ({ id, name }));
const sameAccounts = (a: { id: number; name: string }[], b: { id: number; name: string }[]) => {
  const x = [...a].sort(compareRetirementRosterRows), y = [...b].sort(compareRetirementRosterRows);
  return x.length === y.length && x.every((row, i) => row.id === y[i].id && row.name === y[i].name);
};
const nextMidnightDelay = () => { const now = new Date(); return Math.min(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1).getTime() - now.getTime(), 2 ** 31 - 1); };

/**
 * Session-only, read-only controller for "extra money into one investment account" questions (M5).
 *
 * The Dashboard's accounts let the card claim a question at once, but they are never authorization: the native roster is read before any
 * account-specific review and a mismatch discards the flow. Consent can leave only from the review or result that is on screen; immediately
 * before calculating, the account is read again with the reviewed revision and must come back identical. Any observed in-app write, window
 * focus that finds a change, date rollover, lock, profile switch or data change retires the screen and its consent; nothing is refreshed silently.
 */
export function useRetirementScenario(props: { getContext: () => ParseContext; dataKey: unknown; reloadKey?: unknown; createClient?: () => RetirementClient }) {
  const latest = useRef(props); latest.current = props;
  const [runtime] = useState(() => ({ alive: false, sequence: 0, client: null as RetirementClient | null, pending: null as Pending | null, abort: null as AbortController | null }));
  const [view, setView] = useState<View>({ question: "", owner: null, screen: null, live: null, clarification: null, openReturnChoice: false });
  const parseContext = (): RetirementParseContext => { const c = latest.current.getContext(); return { today: c.today, investmentAccounts: dashboardAccounts(c) }; };
  const owner = (): Owner => ({ data: latest.current.dataKey, reload: latest.current.reloadKey, context: fingerprint(latest.current.getContext()) });
  const current = (o: Owner) => o.data === latest.current.dataKey && o.reload === latest.current.reloadKey && o.context === fingerprint(latest.current.getContext());
  const liveOf = (p: Pending): RetirementParseContext => ({ today: latest.current.getContext().today, investmentAccounts: p.roster ? p.roster.accounts.map(({ id, name }) => ({ id, name })) : dashboardAccounts(latest.current.getContext()) });
  const invalidate = () => { runtime.sequence++; runtime.abort?.abort(); runtime.abort = null; };
  const client = () => runtime.client ??= (latest.current.createClient ?? createFinancialClient)();
  const showStale = (message = RETIREMENT_CHANGED_MESSAGE, stage: "stale" | "error" = "stale") =>
    runtime.alive && setView(v => ({ question: v.question, owner: null, clarification: null, openReturnChoice: false, live: parseContext(), screen: { stage, message } }));
  const retire = (message = RETIREMENT_CHANGED_MESSAGE, stage: "stale" | "error" = "stale") => { if (import.meta.env.TAURI_ENV_DEBUG === "true" || import.meta.env.TAURI_ENV_DEBUG === true) traceRetire(); invalidate(); runtime.pending = null; showStale(message, stage); };
  const cancel = () => { invalidate(); runtime.pending = null; if (runtime.alive) setView({ question: "", owner: null, screen: null, live: null, clarification: null, openReturnChoice: false }); };
  const publish = (p: Pending, screen: RetirementScreen) => {
    if (runtime.alive && runtime.pending === p && current(p.owner)) {
      const shown = structuredClone(screen);
      if (screen.stage === "review" && (import.meta.env.TAURI_ENV_DEBUG === "true" || import.meta.env.TAURI_ENV_DEBUG === true)) p.traceReview?.(shown);
      setView({ question: p.question, owner: p.owner, screen: shown, live: liveOf(p), clarification: null, openReturnChoice: p.openReturnChoice === true });
    }
  };
  const active = (p: Pending, mine: number) => runtime.alive && runtime.sequence === mine && runtime.pending === p;
  const begin = (p: Pending, phase: Phase) => { p.phase = phase; const abort = new AbortController(); runtime.abort = abort; return { mine: ++runtime.sequence, abort }; };
  /** Applies a failed or cancelled read to the screen. Returns true when the flow can go on. */
  const settled = <T,>(p: Pending, mine: number, result: RetirementReadResult<T>): result is { status: "read"; value: T } => {
    if (!active(p, mine) || result.status === "cancelled") return false;
    if (result.status === "read") return true;
    retire(result.message, result.status); return false;
  };

  useEffect(() => {
    runtime.alive = true;
    const inspect = () => { const p = runtime.pending; if (p && !current(p.owner)) retire(); };
    const revalidate = () => {
      inspect();
      const p = runtime.pending;
      if (!p || p.checking) return;
      if (p.phase === "choices" && p.roster) void recheckRoster(p, p.roster);
      else if ((p.phase === "review" || p.phase === "result" || p.phase === "explore") && p.read) void recheckAccount(p, p.read);
    };
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { timer = setTimeout(() => { inspect(); arm(); }, nextMidnightDelay()); };
    arm();
    window.addEventListener("focus", revalidate);
    const stopWrites = onDataWrite(() => { if (runtime.pending) retire(); });
    return () => {
      if (import.meta.env.TAURI_ENV_DEBUG === "true" || import.meta.env.TAURI_ENV_DEBUG === true) traceRetire();
      runtime.alive = false; runtime.sequence++; runtime.abort?.abort(); runtime.abort = null; runtime.pending = null;
      runtime.client?.dispose(); runtime.client = null;
      clearTimeout(timer); window.removeEventListener("focus", revalidate); stopWrites();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers read the latest props through refs
  }, [runtime]);
  // Drop retained evidence, not only its rendering, whenever the rendered owner changes.
  useEffect(() => { if (runtime.pending && !current(runtime.pending.owner)) retire(); });

  /** The frozen domain reader, bound to a source that stays valid only while this step of this flow is the live one. */
  async function readAccount(p: Pending, mine: number, abort: AbortController, accountId: number, expected: RetirementSource): Promise<RetirementReadResult<Read>> {
    const result = await readRetirementContext({ accountId, client: retirementContextClient(client()), currentSource: () => (active(p, mine) && current(p.owner) ? expected : null), signal: abort.signal });
    if (result.status === "context") return { status: "read", value: { context: result.context, inflation: result.inflation } };
    return active(p, mine) ? result : { status: "cancelled" };
  }

  /** Window focus: confirm a showing review or result is still the live data. Never refreshes it; anything else removes it. */
  async function recheckAccount(p: Pending, held: Read) {
    p.checking = true; const abort = new AbortController(), mine = runtime.sequence; runtime.abort = abort;
    try {
      const result = await readAccount(p, mine, abort, held.context.account.id, held.context.source);
      if (!active(p, mine) || result.status === "cancelled") return;
      if (result.status !== "read") return retire(result.message, result.status);
      if (!sameRead(held, result.value)) retire();
    } finally { p.checking = false; }
  }
  async function recheckRoster(p: Pending, roster: Roster) {
    p.checking = true; const abort = new AbortController(), mine = runtime.sequence; runtime.abort = abort;
    try {
      const result = await readRetirementRoster({ client: client(), expectedRevision: roster.revision, signal: abort.signal, isCurrent: () => active(p, mine) && current(p.owner) });
      if (!active(p, mine) || result.status === "cancelled") return;
      if (result.status !== "read") return retire(result.message, result.status);
      if (!sameAccounts(result.value.accounts, roster.accounts)) retire();
    } finally { p.checking = false; }
  }
  /** What a fresh read must equal for the reviewed details to still stand: the same source, the same context, and when known the same inflation. */
  const sameRead = (held: { context: RetirementContext; inflation: RetirementContextRead["inflation"] | null }, fresh: Read) =>
    retirementFreshness(held.context.source, { source: fresh.context.source, today: latest.current.getContext().today }) === "current" &&
    equal(held.context, fresh.context) && (held.inflation === null || equal(held.inflation, fresh.inflation));

  function showChoices(p: Pending, monthCandidate: string | null) {
    p.phase = "choices"; delete p.review; delete p.calculation; delete p.shown;
    const today = latest.current.getContext().today, saved = p.read?.context.retirementMonth ?? null;
    // A saved month beyond what can be calculated stays saved evidence: explained on the card, never offered as a candidate.
    const savedMonthLimit = monthCandidate === null && p.draft.retirementMonth === null && retirementSavedMonthBeyondLimit(saved, today) ? saved : null;
    publish(p, { stage: "choices", draft: structuredClone(p.draft), accounts: p.roster!.accounts.map(({ id, name }) => ({ id, name })), today, monthCandidate, savedMonthLimit });
  }
  const monthCandidate = (p: Pending, read: Read | undefined) => {
    const month = read?.context.retirementMonth ?? null;
    return month !== null && p.draft.retirementMonth === null && retirementMonthUsable(month, latest.current.getContext().today) ? month : null;
  };

  function ask(question: string): boolean {
    cancel();
    const context = latest.current.getContext(), parsed = parseRetirementScenario(question, { ...parseContext(), categories: context.categories, merchants: context.merchants });
    if (!parsed) return false;
    const origin = owner();
    if (parsed.kind === "retirement-clarify") {
      setView({ question, owner: origin, screen: null, live: null, clarification: structuredClone(parsed.clarification), openReturnChoice: false });
      return true;
    }
    const empty: RetirementDraft = { sourceText: question, accountId: null, extra: { kind: null, amount: null }, startDate: context.today, retirementMonth: null, assumptions: { annualReturnPct: null, inflationPct: null }, missing: [], hints: [] };
    const p: Pending = { question, owner: origin, draft: parsed.kind === "retirement" ? structuredClone(parsed.draft) : empty, phase: "other" };
    if (import.meta.env.TAURI_ENV_DEBUG === "true" || import.meta.env.TAURI_ENV_DEBUG === true) p.traceReview = traceReviewPublisher();
    runtime.pending = p;
    if (parsed.kind === "retirement-unsupported") publish(p, { stage: "unsupported", reason: parsed.reason });
    else void start(p);
    return true;
  }

  /** The authority step: read the native roster, require it to match what the draft was parsed against, then show the choices or the review. */
  async function start(p: Pending) {
    const { mine, abort } = begin(p, "roster");
    publish(p, { stage: "reading", accountName: null });
    const result = await readRetirementRoster({ client: client(), expectedRevision: null, signal: abort.signal, isCurrent: () => active(p, mine) && current(p.owner) });
    if (!settled(p, mine, result)) return;
    const roster = result.value;
    if (!sameAccounts(roster.accounts, dashboardAccounts(latest.current.getContext())) || roster.asOf !== latest.current.getContext().today) return retire();
    p.roster = { accounts: roster.accounts.map(({ id, name }) => ({ id, name })), revision: { local: roster.revision.local, external: roster.revision.external }, source: retirementSourceFromRoster(roster) };
    if (p.draft.missing.length) {
      // A named account is read before any month is offered, so its saved month can be a candidate. Without a named account the choices come first.
      if (p.draft.accountId === null) return showChoices(p, null);
      if (!(await loadAccount(p, p.draft.accountId))) return;
      return showChoices(p, monthCandidate(p, p.read));
    }
    const built = retirementCompleteEvent(p.draft, liveOf(p), null);
    if (!built.ok) return retire(built.reason, "error");
    await complete(p, built.event);
  }

  /** Shows the account being read, then reads it bound to the roster's revision. True when the read was accepted and is held for the next step. */
  async function loadAccount(p: Pending, accountId: number): Promise<boolean> {
    const name = p.roster!.accounts.find(a => a.id === accountId)?.name ?? null;
    const { mine, abort } = begin(p, "reading");
    publish(p, { stage: "reading", accountName: name });
    const result = await readAccount(p, mine, abort, accountId, p.roster!.source);
    if (!settled(p, mine, result)) return false;
    p.read = result.value;
    return true;
  }

  async function choices(event: RetirementChoicesEvent) {
    const p = runtime.pending;
    if (!p || p.phase !== "choices" || !p.roster) return;
    if (!current(p.owner)) return retire();
    const checked = validateRetirementChoicesEvent(event, liveOf(p));
    if (!checked.ok) { p.phase = "other"; return publish(p, { stage: "error", message: checked.reason }); }
    if (event.step === "account") {
      p.draft = structuredClone(event.draft);
      if (!(await loadAccount(p, event.draft.accountId!))) return;
      if (!p.draft.missing.length) { // choosing the account settled everything the question left open
        const built = retirementCompleteEvent(p.draft, liveOf(p), null);
        return built.ok ? complete(p, built.event) : retire(built.reason, "error");
      }
      return showChoices(p, monthCandidate(p, p.read));
    }
    await complete(p, structuredClone(event));
  }

  /** The complete step: read the account bound to what was already seen, then build the review through the contract. */
  async function complete(p: Pending, event: Extract<RetirementChoicesEvent, { step: "complete" }>) {
    const held = p.read && p.read.context.account.id === event.intent.accountId ? p.read : undefined;
    const expected = held ? held.context.source : p.roster!.source;
    const { mine, abort } = begin(p, "reading");
    publish(p, { stage: "reading", accountName: p.roster!.accounts.find(a => a.id === event.intent.accountId)?.name ?? null });
    const result = await readAccount(p, mine, abort, event.intent.accountId, expected);
    if (!settled(p, mine, result)) return;
    if (result.value.context.source.asOf !== latest.current.getContext().today) return retire();
    const built = buildRetirementReview(event, { context: result.value.context, inflation: result.value.inflation }, liveOf(p));
    if (!built.ok) { p.phase = "other"; return publish(p, { stage: "error", message: built.reason }); }
    p.read = result.value; p.review = built.review; delete p.calculation; delete p.shown;
    p.phase = "review"; publish(p, { stage: "review", review: built.review });
  }

  /** Only the review on screen can authorize a calculation, and only with values it could itself have produced. */
  function authorizeReview(p: Pending, value: ConfirmedRetirementScenario): { scenario: ConfirmedRetirementScenario; review: RetirementReview } | null {
    const reviewed = p.review!;
    let scenario: ConfirmedRetirementScenario;
    try { scenario = structuredClone(value); } catch { return null; }
    if (!record(scenario) || scenario.confirmed !== true || !record(scenario.intent) || !record(scenario.assumptions)) return null;
    let basis = reviewed;
    if (scenario.intent.retirementMonth !== reviewed.intent.retirementMonth) {
      const typed = withRetirementMonth(reviewed, scenario.intent.retirementMonth);
      if (!typed.ok) return null;
      basis = typed.review;
    }
    if (!equal(scenario.intent, basis.intent) || !equal(scenario.context, basis.context)) return null;
    const a = scenario.assumptions, context = basis.context;
    if (a.monthlyContribution?.basis === "context" && (context.contribution.kind === "missing" || a.monthlyContribution.amount !== context.contribution.monthlyAmount)) return null;
    if (a.returns.kind === "confirmed-return") {
      if (a.returns.sensitivity !== null) return null;
      if (a.returns.basis === "stored-plan" && (context.returnAssumption.kind !== "stored-plan" || a.returns.annualPct !== context.returnAssumption.annualPct)) return null;
    }
    const live = { today: context.source.asOf, investmentAccounts: [{ id: context.account.id, name: context.account.name }], source: context.source };
    return validateConfirmedRetirementScenario(scenario, live).ok ? { scenario, review: basis } : null;
  }
  function authorizeExploration(p: Pending, value: ConfirmedRetirementScenario): ConfirmedRetirementScenario | null {
    const shown = p.calculation;
    if (!shown || shown.kind !== "preview" || !record(value) || !record(value.assumptions) || !record(value.assumptions.returns) || value.assumptions.returns.kind !== "confirmed-return") return null;
    const built = buildExploreConfirmation(shown as PreviewCalculation, value.assumptions.returns.sensitivity as never);
    return built.ok && equal(built.scenario, value) ? structuredClone(built.scenario) : null;
  }

  /** The one place a confirmation is accepted: authorize, re-read with the reviewed revision, require an identical read, then calculate. */
  async function confirm(value: ConfirmedRetirementScenario, kind: "review" | "explore") {
    const p = runtime.pending;
    if (!p || p.phase !== (kind === "review" ? "review" : "explore")) return;
    if (!current(p.owner)) return retire();
    let scenario: ConfirmedRetirementScenario, review: RetirementReview | undefined;
    if (kind === "review") { const ok = authorizeReview(p, value); if (!ok) { p.phase = "other"; return publish(p, { stage: "error", message: INVALID }); } scenario = ok.scenario; review = ok.review; }
    else { const ok = authorizeExploration(p, value); if (!ok) { p.phase = "other"; return publish(p, { stage: "error", message: INVALID }); } scenario = ok; }
    const reviewedContext = scenario.context, inflation = kind === "review" ? p.review!.inflation : p.read?.inflation ?? null;
    const { mine, abort } = begin(p, "confirming");
    publish(p, { stage: "reading", accountName: reviewedContext.account.name });
    const result = await readAccount(p, mine, abort, reviewedContext.account.id, reviewedContext.source);
    if (!settled(p, mine, result)) return;
    if (!sameRead({ context: reviewedContext, inflation }, result.value)) return retire();
    if (reviewedContext.source.asOf !== latest.current.getContext().today || !current(p.owner)) return retire();
    const calculation = calculateRetirementScenario(scenario);
    if (!active(p, mine)) return;
    if (review) p.review = review;
    p.calculation = calculation as Pending["calculation"];
    if (calculation.kind === "preview") { p.phase = "result"; p.shown = "result"; publish(p, { stage: "result", calculation }); }
    else if (calculation.kind === "extra-deposits-only") { p.phase = "result"; p.shown = "deposits-only"; publish(p, { stage: "deposits-only", calculation }); }
    else { p.phase = "result"; p.shown = "blocked"; publish(p, { stage: "blocked", calculation }); }
  }

  function explore() {
    const p = runtime.pending;
    if (!p || p.phase !== "result" || p.shown !== "result" || p.calculation?.kind !== "preview" || p.calculation.confirmedReturn === null) return;
    if (!current(p.owner)) return retire();
    p.phase = "explore"; publish(p, { stage: "explore", calculation: p.calculation });
  }
  function back() {
    const p = runtime.pending;
    if (!p || p.phase !== "explore" || p.calculation?.kind !== "preview") return;
    if (!current(p.owner)) return retire();
    p.phase = "result"; p.shown = "result"; publish(p, { stage: "result", calculation: p.calculation });
  }
  function edit(request?: { chooseReturn: true }) {
    const p = runtime.pending;
    if (!p || !p.review || !p.read || (p.phase !== "result" && p.phase !== "explore")) return;
    if (!current(p.owner)) return retire();
    invalidate();
    const review = p.review;
    // Only choosing a return from exact deposits, or leaving the explore card, goes back to the review. A refused ("needs attention") card is like a result:
    // its "Change the details" re-asks account, amount, cadence and month (Content-Flow.md:50, Requirements-Checklist.md:150), because the terms that were refused are
    // what the person has to change, and the review that produced the refusal is not offered again.
    if ((request?.chooseReturn && p.shown === "deposits-only") || p.phase === "explore") {
      p.phase = "review"; delete p.calculation; delete p.shown; p.openReturnChoice = request?.chooseReturn === true;
      return publish(p, { stage: "review", review });
    }
    // Any core detail can change, so the account is asked again too. The result, the review and the account read are dropped here, so nothing
    // from the previous account (its value, plan, return, inflation or saved month) can reach the next review; the next account is read afresh.
    p.openReturnChoice = false; delete p.read;
    p.draft = { sourceText: p.question, accountId: null, extra: { kind: null, amount: null }, startDate: latest.current.getContext().today, retirementMonth: null,
      assumptions: structuredClone(review.questionAssumptions), missing: ["account", "extra-amount", "cadence", "retirement-month"], hints: [] };
    showChoices(p, null);
  }

  // A callback kept from an earlier screen is not consent for an identical new one.
  const renderedPending = runtime.pending, renderedReview = renderedPending?.phase === "review" ? renderedPending.review : undefined;
  const renderedExplore = renderedPending?.phase === "explore" ? renderedPending.calculation : undefined;
  const expired = view.owner !== null && !current(view.owner);
  return {
    screen: expired ? { stage: "stale" as const, message: RETIREMENT_CHANGED_MESSAGE } : view.screen,
    live: view.live ?? NO_LIVE,
    clarification: expired ? null : view.clarification, openReturnChoice: view.openReturnChoice, question: view.question,
    ask,
    choices: (event: RetirementChoicesEvent) => (runtime.pending === renderedPending && renderedPending?.phase === "choices" ? choices(event) : Promise.resolve()),
    confirm: (scenario: ConfirmedRetirementScenario) => {
      if (runtime.pending !== renderedPending || !renderedPending) return Promise.resolve();
      if (renderedReview && renderedPending.review === renderedReview) return confirm(scenario, "review");
      if (renderedExplore && renderedPending.calculation === renderedExplore) return confirm(scenario, "explore");
      return Promise.resolve();
    },
    explore, back, edit, cancel, restart: () => { void ask(view.question); },
  };
}

export type { RetirementClient };
