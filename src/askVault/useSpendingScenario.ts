import { CHANGED_BODY } from "./changedState";
import { useEffect, useRef, useState } from "react";
import { createFinancialClient } from "../financialReads";
import type { ScenarioBaselineChoice, ScenarioChoiceAnswers, SpendingScenarioScreen } from "../SpendingScenarioDialog";
import { baselineFromSnapshot, baselineRequest, sameScenarioSource, scenarioSourceFromSnapshot, scenarioSourceRequest } from "./spendingScenarioBaseline";
import { parseSpendingScenario } from "./spendingScenarioParser";
import { calculateSpendingScenario, scenarioMoneyToCents, scenarioMonthlyBaseline } from "./spendingScenarioMath";
import { validateScenarioIntent } from "./spendingScenarioContract";
import type { ScenarioBaseline, SpendingScenarioDraft, SpendingScenarioIntent } from "./spendingScenarioContract";
import { explainFailure } from "./controller";
import type { AskClarification, ParseContext } from "./types";

type Client = Pick<ReturnType<typeof createFinancialClient>, "askVault" | "dispose">;
type Owner = { dataKey: unknown; reloadKey: unknown; context: string };
type Pending = { question: string; owner: Owner; draft: SpendingScenarioDraft; intent?: SpendingScenarioIntent; baseline?: ScenarioBaseline };
type View = { question: string; owner: Owner | null; screen: SpendingScenarioScreen | null; clarification: AskClarification | null };
const CHANGED = CHANGED_BODY;
const fingerprint = (context: ParseContext) => JSON.stringify([context.today, context.categories, context.accounts, context.familyMembers]);

/** Session-only scenario controller. No writes or persistence; every preview needs explicit source-bound confirmation. */
export function useSpendingScenario(props: {
  getContext: () => ParseContext;
  dataKey: unknown;
  reloadKey?: unknown;
  createClient?: () => Client;
}) {
  const latest = useRef(props);
  latest.current = props;
  const [runtime] = useState(() => ({ alive: false, sequence: 0, client: null as Client | null, pending: null as Pending | null }));
  const [view, setView] = useState<View>({ question: "", owner: null, screen: null, clarification: null });
  const owner = (): Owner => ({ dataKey: latest.current.dataKey, reloadKey: latest.current.reloadKey, context: fingerprint(latest.current.getContext()) });
  const current = (origin: Owner) => origin.dataKey === latest.current.dataKey && origin.reloadKey === latest.current.reloadKey && origin.context === fingerprint(latest.current.getContext());
  const retire = () => {
    runtime.sequence++;
    runtime.pending = null;
    if (runtime.alive) setView(v => ({ question: v.question, owner: null, clarification: null, screen: { stage: "stale", message: CHANGED } }));
  };
  const cancel = () => {
    runtime.sequence++;
    runtime.pending = null;
    if (runtime.alive) setView({ question: "", owner: null, screen: null, clarification: null });
  };
  const client = () => runtime.client ??= (latest.current.createClient ?? createFinancialClient)();
  const publish = (pending: Pending, screen: SpendingScenarioScreen) => {
    if (!runtime.alive || !current(pending.owner)) return;
    setView({ question: pending.question, owner: pending.owner, screen, clarification: null });
  };

  useEffect(() => {
    runtime.alive = true;
    // Date rollover also matters when no transaction/reload event occurs. Focus resumes a sleeping WebView promptly.
    const check = () => {
      const pending = runtime.pending;
      const now = latest.current.getContext();
      if (pending && (pending.owner.dataKey !== latest.current.dataKey || pending.owner.reloadKey !== latest.current.reloadKey || pending.owner.context !== fingerprint(now))) {
        runtime.sequence++;
        runtime.pending = null;
        setView(v => ({ question: v.question, owner: null, clarification: null, screen: { stage: "stale", message: CHANGED } }));
      }
    };
    const timer = setInterval(check, 1000);
    window.addEventListener("focus", check);
    return () => {
      runtime.alive = false;
      runtime.sequence++;
      runtime.pending = null;
      runtime.client?.dispose();
      runtime.client = null;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [runtime]);

  async function load(pending: Pending, intent: SpendingScenarioIntent) {
    const mine = ++runtime.sequence;
    runtime.pending = { ...pending, intent };
    publish(pending, { stage: "reading", category: intent.category });
    try {
      const today = latest.current.getContext().today;
      const request = baselineRequest(intent.category, today, null);
      const baseline = baselineFromSnapshot(await client().askVault(request), request);
      if (!runtime.alive || mine !== runtime.sequence) return;
      if (!current(pending.owner) || baseline.source.asOf !== today) return retire();
      runtime.pending = { ...pending, intent, baseline };
      publish(pending, { stage: "review", intent, baseline });
    } catch (failure) {
      if (!runtime.alive || mine !== runtime.sequence) return;
      if (!current(pending.owner)) return retire();
      const result = explainFailure(failure);
      publish(pending, { stage: result.status === "stale" ? "stale" : "error", message: result.message });
    }
  }

  function ask(question: string): boolean {
    const context = latest.current.getContext();
    const parsed = parseSpendingScenario(question, context);
    cancel();
    if (!parsed) return false;
    const origin = owner();
    if (parsed.kind === "scenario-clarify") {
      runtime.pending = { question, owner: origin, draft: { sourceText: question, category: null, reduction: null, cadence: null, horizon: null, partialMonth: null, missing: ["category"] } };
      setView({ question, owner: origin, screen: null, clarification: parsed.clarification });
    } else if (parsed.kind === "scenario-unsupported") {
      setView({ question, owner: origin, screen: { stage: "error", message: parsed.reason }, clarification: null });
    } else {
      const pending = { question, owner: origin, draft: parsed.draft };
      runtime.pending = pending;
      if (parsed.draft.missing.length) publish(pending, { stage: "choices", draft: parsed.draft, today: context.today });
      else void choose({}, pending);
    }
    return true;
  }

  async function choose(answers: ScenarioChoiceAnswers, supplied = runtime.pending) {
    const pending = supplied;
    if (!pending || !current(pending.owner)) return retire();
    const draft = pending.draft;
    const intent = {
      version: 1, category: draft.category, reduction: draft.reduction,
      cadence: answers.cadence ?? draft.cadence,
      horizon: answers.range ?? draft.horizon,
      partialMonth: answers.partialMonth ?? draft.partialMonth,
    };
    const context = latest.current.getContext();
    const checked = validateScenarioIntent(intent, { asOf: context.today, categories: context.categories });
    if (!checked.ok) return publish(pending, { stage: "error", message: checked.reason });
    await load(pending, intent as SpendingScenarioIntent);
  }

  async function confirm(choice: ScenarioBaselineChoice) {
    const pending = runtime.pending;
    if (!pending?.intent || !pending.baseline) return;
    if (!current(pending.owner)) return retire();
    const mine = ++runtime.sequence;
    publish(pending, { stage: "reading", category: pending.intent.category });
    try {
      // A validated native read checks the global revision, without recalculating the reviewed baseline.
      const request = scenarioSourceRequest(pending.intent.category, pending.baseline.source.asOf, pending.baseline.source.revision);
      const fresh = scenarioSourceFromSnapshot(await client().askVault(request));
      if (!runtime.alive || mine !== runtime.sequence) return;
      if (!current(pending.owner) || !sameScenarioSource(fresh, pending.baseline.source)) return retire();
      const baseline: ScenarioBaseline = choice.kind === "manual"
        ? { kind: "manual", monthlyAmount: choice.monthlyAmount, source: fresh }
        : pending.baseline.kind === "recorded"
          ? { ...pending.baseline, ...(choice.shortHistoryAccepted ? { shortHistoryAccepted: true as const } : {}) }
          : pending.baseline;
      const result = calculateSpendingScenario({ intent: pending.intent, baseline, confirmed: true });
      if (!current(pending.owner)) return retire();
      runtime.pending = { ...pending, baseline };
      if (result.kind === "preview") publish(pending, { stage: "result", calculation: result });
      else if (result.kind === "reduction-too-large") publish(pending, { stage: "refused", intent: pending.intent, baseline });
      else publish(pending, { stage: "review", intent: pending.intent, baseline });
    } catch (failure) {
      if (!runtime.alive || mine !== runtime.sequence) return;
      if (!current(pending.owner)) return retire();
      const result = explainFailure(failure);
      publish(pending, { stage: result.status === "stale" ? "stale" : "error", message: result.message });
    }
  }

  function manualBaseline() {
    const pending = runtime.pending;
    if (!pending?.intent || !pending.baseline) return;
    if (!current(pending.owner)) return retire();
    const amount = scenarioMonthlyBaseline(pending.baseline);
    const baseline: ScenarioBaseline = { kind: "manual", monthlyAmount: amount ? scenarioMoneyToCents(amount) : "0", source: pending.baseline.source };
    runtime.pending = { ...pending, baseline };
    publish(pending, { stage: "review", intent: pending.intent, baseline });
  }

  const expired = view.owner !== null && !current(view.owner);
  return {
    screen: expired ? { stage: "stale" as const, message: CHANGED } : view.screen,
    clarification: expired ? null : view.clarification,
    question: view.question, ask, choose, confirm, cancel, manualBaseline,
    restart: () => ask(view.question),
  };
}
