import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "./nativeDialog";
import { getCurrentGeneration } from "./profileUiState";
import { errorMessage } from "./errorMessage";
import {
  validateStatementFinished,
  validateStatementLines,
  validateStatementRead,
  validateStatementReview,
  type FinishDecisions,
  type StatementFinished,
  type StatementLineText,
  type StatementRead,
  type StatementReview,
  type TeachMarks,
} from "./statementContracts";

export type StatementPhase =
  | { kind: "idle" }
  | { kind: "choose_section"; read: StatementRead }
  | { kind: "review"; review: StatementReview }
  | { kind: "teach"; review: StatementReview; lines: StatementLineText[]; attempts: number }
  | { kind: "done"; finished: StatementFinished };

/** Owns the upload, review, (teach), finish flow for one account. Every call carries the profile
 * generation, so a profile switch mid-review is refused by the backend. Every review and teach step
 * hands back a new token that replaces the old one; the hook always uses the newest. */
export function useStatementReconcile(accountId: number) {
  const [phase, setPhase] = useState<StatementPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef<string | null>(null);
  const generation = useRef<number | null>(null);
  const flip = useRef(false);
  const section = useRef(0);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    (periodStart: string, periodEnd: string, kind: "pdf" | "download" = "pdf") =>
      run(async () => {
        const filters =
          kind === "pdf"
            ? [{ name: "Statement (PDF)", extensions: ["pdf"] }]
            : [{ name: "Bank download", extensions: ["csv", "ofx", "qfx", "qif"] }];
        const path = await open({ multiple: false, directory: false, filters });
        if (typeof path !== "string") return;
        const current = await getCurrentGeneration();
        const read = validateStatementRead(
          await invoke("read_statement", { path, accountId, periodStart, periodEnd, generation: current }),
        );
        generation.current = current;
        flip.current = false;
        section.current = 0;
        // A review that comes with the read carries the token to use from here on.
        token.current = read.review ? read.review.token : read.token;
        setPhase(read.review ? { kind: "review", review: read.review } : { kind: "choose_section", read });
      }),
    [accountId, run],
  );

  const review = useCallback(async (sectionIndex: number, flipped: boolean) => {
    const r = validateStatementReview(
      await invoke("review_statement", { token: token.current, sectionIndex, flip: flipped, generation: generation.current }),
    );
    token.current = r.token;
    section.current = sectionIndex;
    flip.current = flipped;
    setPhase({ kind: "review", review: r });
  }, []);

  const chooseSection = useCallback((index: number) => run(() => review(index, flip.current)), [review, run]);
  const setFlip = useCallback((value: boolean) => run(() => review(section.current, value)), [review, run]);

  const openTeach = useCallback(
    () =>
      run(async () => {
        if (phase.kind !== "review") return;
        const lines = validateStatementLines(await invoke("statement_lines", { token: token.current, generation: generation.current }));
        setPhase({ kind: "teach", review: phase.review, lines, attempts: 0 });
      }),
    [phase, run],
  );

  const teach = useCallback(
    (marks: TeachMarks) =>
      run(async () => {
        if (phase.kind !== "teach") return;
        const r = validateStatementReview(
          await invoke("teach_statement_layout", { token: token.current, marks, generation: generation.current }),
        );
        token.current = r.token;
        const stillFailing = r.activity_check.outcome === "failed" || r.holdings_check.outcome === "failed";
        setPhase(stillFailing ? { kind: "teach", review: r, lines: phase.lines, attempts: phase.attempts + 1 } : { kind: "review", review: r });
      }),
    [phase, run],
  );

  const finish = useCallback(
    (decisions: FinishDecisions) =>
      run(async () => {
        const finished = validateStatementFinished(
          await invoke("finish_statement_reconciliation", { token: token.current, decisions, generation: generation.current }),
        );
        token.current = null;
        setPhase({ kind: "done", finished });
      }),
    [run],
  );

  const cancel = useCallback(() => {
    const openToken = token.current;
    token.current = null;
    setError(null);
    setPhase({ kind: "idle" });
    if (openToken) {
      void Promise.resolve(invoke("cancel_statement_review", { token: openToken, generation: generation.current })).catch(() => {});
    }
  }, []);

  const backToReview = useCallback(() => {
    if (phase.kind === "teach") setPhase({ kind: "review", review: phase.review });
  }, [phase]);

  return { phase, error, busy, start, chooseSection, setFlip, openTeach, teach, finish, cancel, backToReview };
}
