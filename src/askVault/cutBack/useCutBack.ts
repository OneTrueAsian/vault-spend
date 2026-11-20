import { useEffect, useRef, useState } from "react";
import { createFinancialClient } from "../../shared/native/financialReads";
import { CHANGED_BODY } from "../common/changedState";
import type { ParseContext } from "../common/types";
import { buildCutBackAnswer, cutBackMonths, isCutBackQuestion, type CutBackAnswer } from "./cutBack";

type Financial = ReturnType<typeof createFinancialClient>;
export type CutBackClient = Partial<Pick<Financial, "report" | "budget">> & Pick<Financial, "dispose">;

export type CutBackView =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "answer"; answer: CutBackAnswer }
  | { status: "stale"; message: string }
  | { status: "error"; message: string };

/**
 * Reads the four full months before this one and this month's budget, then lists where the person could look.
 * Like the other readers, a reply that arrives after a new question, a data change or the card closing is never shown.
 */
export function useCutBack(props: { getContext: () => ParseContext; dataKey: unknown; reloadKey?: unknown; createClient?: () => CutBackClient }) {
  const latest = useRef(props);
  latest.current = props;
  const [runtime] = useState(() => ({ alive: false, sequence: 0, client: null as CutBackClient | null, owner: null as { data: unknown; reload: unknown } | null }));
  const [view, setView] = useState<CutBackView>({ status: "idle" });

  useEffect(() => {
    runtime.alive = true;
    return () => {
      runtime.alive = false;
      runtime.sequence++;
      runtime.client?.dispose();
      runtime.client = null;
    };
  }, [runtime]);

  // An answer on screen, or one being read, belongs to the data it was read from.
  useEffect(() => {
    const owner = runtime.owner;
    if (!owner || (owner.data === props.dataKey && owner.reload === props.reloadKey)) return;
    runtime.sequence++;
    runtime.owner = null;
    setView({ status: "stale", message: CHANGED_BODY });
  }, [props.dataKey, props.reloadKey, runtime]);

  const cancel = () => {
    runtime.sequence++;
    runtime.owner = null;
    if (runtime.alive) setView({ status: "idle" });
  };

  /** True when the question is one this reader answers; the read then runs on its own. */
  const ask = (question: string): boolean => {
    if (!isCutBackQuestion(question)) return false;
    const mine = ++runtime.sequence;
    const owner = { data: latest.current.dataKey, reload: latest.current.reloadKey };
    runtime.owner = owner;
    setView({ status: "loading" });
    const today = latest.current.getContext().today;
    const client = runtime.client ??= (latest.current.createClient ?? createFinancialClient)();
    const current = () => runtime.alive && runtime.sequence === mine && runtime.owner === owner;
    void (async () => {
      try {
        if (!client.report || !client.budget) throw new Error("unavailable");
        const { from, to } = cutBackMonths(today);
        const [report, budget] = await Promise.all([
          client.report(from.year, from.month, to.year, to.month),
          client.budget(Number(today.slice(0, 4)), Number(today.slice(5, 7))),
        ]);
        if (!current()) return;
        if (report.revision.local !== budget.revision.local || report.revision.external !== budget.revision.external) {
          runtime.owner = null;
          setView({ status: "stale", message: CHANGED_BODY });
          return;
        }
        setView({ status: "answer", answer: buildCutBackAnswer({ today, cells: report.cells, actuals: budget.actuals }) });
      } catch {
        if (!current()) return;
        runtime.owner = null;
        setView({ status: "error", message: "Vault Spend couldn't read your spending just now. Ask again." });
      }
    })();
    return true;
  };

  return { view, ask, cancel };
}
