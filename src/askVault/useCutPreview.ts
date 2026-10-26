import { CHANGED_BODY } from "./changedState";
import { useEffect, useRef, useState } from "react";
import { createFinancialClient } from "../financialReads";
import type { CutPreviewScreen } from "../CutPreviewDialog";
import { parseCutPreview } from "./cutPreviewParser";
import { readCutPreviewBaselines } from "./cutPreviewBaseline";
import { calculateCutPreview } from "./cutPreviewMath";
import { validateCutPreviewIntent } from "./cutPreviewContract";
import type { ConfirmedCutPreview, CutPreviewDraft, CutPreviewIntent } from "./cutPreviewContract";
import { sameScenarioSource, scenarioSourceFromSnapshot, scenarioSourceRequest } from "./spendingScenarioBaseline";
import { scenarioBaselineProblem } from "./spendingScenarioMath";
import { explainFailure } from "./controller";
import type { AskClarification, ParseContext } from "./types";

export type CutPreviewClient = Pick<ReturnType<typeof createFinancialClient>, "askVault" | "dispose"> & Partial<Pick<ReturnType<typeof createFinancialClient>, "askVaultBaselines">>;
type Owner = { data: unknown; reload: unknown; context: string };
type Pending = {
  question: string; owner: Owner; draft: CutPreviewDraft | null;
  phase: "choices" | "reading" | "review" | "confirming" | "result" | "other";
  reviewed?: Omit<ConfirmedCutPreview, "confirmed">;
};
type View = { question: string; owner: Owner | null; screen: CutPreviewScreen | null; clarification: AskClarification | null };
const CHANGED = CHANGED_BODY;
const INVALID = "Those choices no longer match the details you reviewed. Start again and confirm every category.";
const fingerprint = (context: ParseContext) => JSON.stringify(context);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Release controller frames on cancellation; the native read may still finish, with no owner/draft retained here. */
function sourceUntilCancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve(null); };
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, failure => { signal.removeEventListener("abort", abort); reject(failure); });
    if (signal.aborted) abort();
  });
}

/** Read-only, session-only M4 controller. Only a current review callback can authorize calculation. */
export function useCutPreview(props: { getContext: () => ParseContext; dataKey: unknown; reloadKey?: unknown; createClient?: () => CutPreviewClient }) {
  const latest = useRef(props); latest.current = props;
  const [runtime] = useState(() => ({ alive: false, sequence: 0, client: null as CutPreviewClient | null, pending: null as Pending | null, abort: null as AbortController | null }));
  const [view, setView] = useState<View>({ question: "", owner: null, screen: null, clarification: null });
  const owner = (): Owner => ({ data: latest.current.dataKey, reload: latest.current.reloadKey, context: fingerprint(latest.current.getContext()) });
  const current = (o: Owner) => o.data === latest.current.dataKey && o.reload === latest.current.reloadKey && o.context === fingerprint(latest.current.getContext());
  const invalidate = () => { runtime.sequence++; runtime.abort?.abort(); runtime.abort = null; };
  const retire = () => {
    invalidate(); runtime.pending = null;
    if (runtime.alive) setView(v => ({ question: v.question, owner: null, clarification: null, screen: { stage: "stale", message: CHANGED } }));
  };
  const cancel = () => {
    invalidate(); runtime.pending = null;
    if (runtime.alive) setView({ question: "", owner: null, screen: null, clarification: null });
  };
  const client = () => runtime.client ??= (latest.current.createClient ?? createFinancialClient)();
  const publish = (p: Pending, screen: CutPreviewScreen) => {
    if (runtime.alive && current(p.owner)) setView({ question: p.question, owner: p.owner, screen: structuredClone(screen), clarification: null });
  };
  const active = (p: Pending, mine: number) => runtime.alive && runtime.sequence === mine && runtime.pending === p;
  const showChoices = (p: Pending) => {
    if (!p.draft) return;
    p.draft = structuredClone(p.draft);
    p.phase = "choices"; delete p.reviewed;
    const c = latest.current.getContext();
    publish(p, { stage: "choices", draft: p.draft, today: c.today, categories: c.categories });
  };

  useEffect(() => {
    runtime.alive = true;
    const inspect = () => {
      const p = runtime.pending;
      const c = latest.current;
      if (p && (p.owner.data !== c.dataKey || p.owner.reload !== c.reloadKey || p.owner.context !== fingerprint(c.getContext()))) {
        runtime.sequence++; runtime.abort?.abort(); runtime.abort = null; runtime.pending = null;
        setView(v => ({ question: v.question, owner: null, clarification: null, screen: { stage: "stale", message: CHANGED } }));
      }
    };
    const timer = setInterval(inspect, 1000);
    window.addEventListener("focus", inspect);
    return () => {
      runtime.alive = false; runtime.sequence++; runtime.abort?.abort(); runtime.abort = null; runtime.pending = null;
      runtime.client?.dispose(); runtime.client = null;
      clearInterval(timer); window.removeEventListener("focus", inspect);
    };
  }, [runtime]);
  // Drop retained evidence too, not only its rendering, whenever a rendered owner changes.
  useEffect(() => { if (runtime.pending && !current(runtime.pending.owner)) retire(); });

  function ask(question: string): boolean {
    cancel();
    const c = latest.current.getContext(), parsed = parseCutPreview(question, c);
    if (!parsed) return false;
    const p: Pending = { question, owner: owner(), draft: parsed.kind === "cut-preview" ? structuredClone(parsed.draft) : null, phase: "other" };
    runtime.pending = p;
    if (parsed.kind === "cut-preview-clarify") setView({ question, owner: p.owner, screen: null, clarification: structuredClone(parsed.clarification) });
    else if (parsed.kind === "cut-preview-unsupported") publish(p, { stage: "error", message: parsed.reason });
    else showChoices(p); // Parsing never stands in for deliberate category/constraint review.
    return true;
  }

  async function choose(value: CutPreviewIntent) {
    const p = runtime.pending;
    if (!p || p.phase !== "choices") return;
    if (!current(p.owner)) return retire();
    const c = latest.current.getContext(), checked = validateCutPreviewIntent(value, { asOf: c.today, categories: c.categories });
    if (!checked.ok) { p.phase = "other"; return publish(p, { stage: "error", message: checked.reason }); }
    const intent = structuredClone(value);
    if (p.draft) p.draft.excludedCategories = p.draft.excludedCategories.filter(category => !intent.categories.some(row => row.category === category));
    // The screen explicitly edits exclusions. The selected live labels, floor/cap/date review is consent for this read, not a calculation.
    p.phase = "reading"; const mine = ++runtime.sequence; const abort = new AbortController(); runtime.abort = abort;
    publish(p, { stage: "reading", categories: intent.categories.map(row => row.category) });
    try {
      const sourceRequest = { ...scenarioSourceRequest(intent.categories[0].category, c.today, { local: 0, external: 0 }), expectedRevision: null };
      const snapshot = await sourceUntilCancelled(client().askVault(sourceRequest), abort.signal);
      if (!active(p, mine)) return;
      if (snapshot === null) return;
      const source = scenarioSourceFromSnapshot(snapshot);
      if (!current(p.owner) || source.asOf !== c.today) return retire();
      const result = await readCutPreviewBaselines({ categories: intent.categories.map(row => row.category), client: client(), signal: abort.signal,
        currentSource: () => active(p, mine) && current(p.owner) ? source : null });
      if (!active(p, mine)) return;
      if (!current(p.owner) || result.status === "stale") return retire();
      if (result.status === "error") { p.phase = "other"; return publish(p, { stage: "error", message: result.message }); }
      p.reviewed = structuredClone({ intent, baselines: result.baselines, source: result.source }); p.phase = "review";
      publish(p, { stage: "review", scenario: p.reviewed });
    } catch (failure) {
      if (!active(p, mine)) return;
      if (!current(p.owner)) return retire();
      const result = explainFailure(failure); p.phase = "other";
      publish(p, { stage: result.status === "stale" ? "stale" : "error", message: result.message });
    }
  }

  async function confirm(value: ConfirmedCutPreview) {
    const p = runtime.pending;
    if (!p || p.phase !== "review" || !p.reviewed) return;
    if (!current(p.owner)) return retire();
    const reviewed = p.reviewed;
    let confirmed: ConfirmedCutPreview;
    try {
      confirmed = structuredClone(value);
      if (!confirmed || confirmed.confirmed !== true || !equal(confirmed.intent, reviewed.intent) || !equal(confirmed.source, reviewed.source) ||
          !Array.isArray(confirmed.baselines) || confirmed.baselines.length !== reviewed.baselines.length) throw new Error(INVALID);
      for (const row of confirmed.baselines) {
        const original = reviewed.baselines.find(b => b.category === row.category)?.baseline, chosen = row.baseline;
        if (!original || scenarioBaselineProblem(chosen) || !sameScenarioSource(chosen.source, reviewed.source)) throw new Error(INVALID);
        const count = original.kind === "recorded" ? original.months.filter(m => m.coverage === "complete").length : 0;
        if (chosen.kind === "recorded") {
          if (count === 0 || !equal({ ...chosen, shortHistoryAccepted: undefined }, { ...original, shortHistoryAccepted: undefined })) throw new Error(INVALID);
        } else if (original.kind === "recorded" && count === 3) throw new Error(INVALID);
      }
    } catch { p.phase = "other"; return publish(p, { stage: "error", message: INVALID }); }
    p.phase = "confirming"; const mine = ++runtime.sequence; const abort = new AbortController(); runtime.abort = abort;
    publish(p, { stage: "reading", categories: reviewed.intent.categories.map(row => row.category) });
    try {
      const snapshot = await sourceUntilCancelled(client().askVault(scenarioSourceRequest(reviewed.intent.categories[0].category, reviewed.source.asOf, reviewed.source.revision)), abort.signal);
      if (!active(p, mine)) return;
      if (snapshot === null) return;
      const source = scenarioSourceFromSnapshot(snapshot);
      if (!current(p.owner) || !sameScenarioSource(source, reviewed.source)) return retire();
      const c = latest.current.getContext(), check = validateCutPreviewIntent(confirmed.intent, { asOf: c.today, categories: c.categories });
      if (!check.ok) return retire();
      const calculation = calculateCutPreview(confirmed);
      if (!active(p, mine) || !current(p.owner)) return retire();
      p.phase = "result";
      publish(p, calculation.kind === "preview" ? { stage: "result", calculation } : { stage: "blocked", calculation });
    } catch (failure) {
      if (!active(p, mine)) return;
      if (!current(p.owner)) return retire();
      const result = explainFailure(failure); p.phase = "other";
      publish(p, { stage: result.status === "stale" ? "stale" : "error", message: result.message });
    }
  }

  function edit(remove?: string) {
    const p = runtime.pending;
    if (!p?.draft) return;
    if (!current(p.owner)) return retire();
    invalidate();
    if (p.reviewed) {
      const intent = p.reviewed.intent;
      p.draft = { ...p.draft, target: structuredClone(intent.target), categories: structuredClone(intent.categories), horizon: structuredClone(intent.horizon), partialMonth: intent.partialMonth, missing: [] };
    }
    if (remove !== undefined) p.draft.categories = p.draft.categories.filter(row => row.category !== remove);
    showChoices(p);
  }
  const expired = view.owner !== null && !current(view.owner);
  // A callback retained from an earlier modal is not consent for a new identical review.
  const renderedPending = runtime.pending;
  const renderedReview = view.screen?.stage === "review" ? renderedPending?.reviewed : undefined;
  const renderedDraft = view.screen?.stage === "choices" ? renderedPending?.draft : undefined;
  return { screen: expired ? { stage: "stale" as const, message: CHANGED } : view.screen, clarification: expired ? null : view.clarification,
    ask,
    choose: (value: CutPreviewIntent) => renderedDraft && runtime.pending === renderedPending && runtime.pending?.draft === renderedDraft ? choose(value) : Promise.resolve(),
    confirm: (value: ConfirmedCutPreview) => renderedReview && runtime.pending === renderedPending && runtime.pending?.reviewed === renderedReview ? confirm(value) : Promise.resolve(),
    cancel, edit: () => edit(), remove: (category: string) => edit(category), restart: () => ask(view.question) };
}
