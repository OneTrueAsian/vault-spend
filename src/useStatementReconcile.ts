import { useCallback, useEffect, useRef, useState } from "react";
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
  const attempts = useRef(0);
  /** Bumped by cancel and unmount: a step still waiting for the backend then ignores its answer. */
  const runId = useRef(0);
  const working = useRef(false);

  /** Runs one step. Steps do not overlap (a second click while one is running is ignored). */
  const run = useCallback(async (work: (id: number) => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    const id = runId.current;
    setBusy(true);
    setError(null);
    try {
      await work(id);
    } catch (e) {
      if (runId.current === id) setError(errorMessage(e));
    } finally {
      if (runId.current === id) {
        working.current = false;
        setBusy(false);
      }
    }
  }, []);

  /** Asks the backend to forget a review, best effort. */
  const forget = useCallback((openToken: string | null) => {
    if (!openToken) return;
    void Promise.resolve(invoke("cancel_statement_review", { token: openToken, generation: generation.current })).catch(() => {});
  }, []);

  /** Checks an answer's shape. A malformed answer leaves nothing usable to continue from, so the
   * flow goes back to the start and the review it belonged to is forgotten. */
  const checked = useCallback(
    <T,>(validate: (v: unknown) => T, raw: unknown): T => {
      try {
        return validate(raw);
      } catch (e) {
        const rawToken = (raw as { token?: unknown } | null)?.token;
        forget(typeof rawToken === "string" ? rawToken : null);
        token.current = null;
        setPhase({ kind: "idle" });
        throw e;
      }
    },
    [forget],
  );

  const start = useCallback(
    (periodStart: string, periodEnd: string, kind: "pdf" | "download" = "pdf") =>
      run(async (id) => {
        const filters =
          kind === "pdf"
            ? [{ name: "Statement (PDF)", extensions: ["pdf"] }]
            : [{ name: "Bank download", extensions: ["csv", "ofx", "qfx", "qif"] }];
        const path = await open({ multiple: false, directory: false, filters });
        if (typeof path !== "string" || runId.current !== id) return;
        const current = await getCurrentGeneration();
        if (runId.current !== id) return;
        const raw = await invoke("read_statement", { path, accountId, periodStart, periodEnd, generation: current });
        generation.current = current;
        if (runId.current !== id) {
          forget((raw as { token?: string } | null)?.token ?? null);
          return;
        }
        const read = checked(validateStatementRead, raw);
        flip.current = false;
        section.current = read.review ? read.review.section_index : 0;
        attempts.current = 0;
        // A review that comes with the read carries the token to use from here on.
        token.current = read.review ? read.review.token : read.token;
        setPhase(read.review ? { kind: "review", review: read.review } : { kind: "choose_section", read });
      }),
    [accountId, run, forget, checked],
  );

  const review = useCallback(
    async (id: number, sectionIndex: number, flipped: boolean) => {
      const raw = await invoke("review_statement", { token: token.current, sectionIndex, flip: flipped, generation: generation.current });
      if (runId.current !== id) {
        forget((raw as { token?: string } | null)?.token ?? null);
        return;
      }
      const r = checked(validateStatementReview, raw);
      token.current = r.token;
      section.current = r.section_index;
      flip.current = flipped;
      setPhase({ kind: "review", review: r });
    },
    [forget, checked],
  );

  const chooseSection = useCallback((index: number) => run((id) => review(id, index, flip.current)), [review, run]);
  const setFlip = useCallback((value: boolean) => run((id) => review(id, section.current, value)), [review, run]);

  const openTeach = useCallback(
    () =>
      run(async (id) => {
        if (phase.kind !== "review") return;
        const lines = validateStatementLines(await invoke("statement_lines", { token: token.current, generation: generation.current }));
        if (runId.current !== id) return;
        setPhase({ kind: "teach", review: phase.review, lines, attempts: attempts.current });
      }),
    [phase, run],
  );

  const teach = useCallback(
    (marks: TeachMarks) =>
      run(async (id) => {
        if (phase.kind !== "teach") return;
        const raw = await invoke("teach_statement_layout", { token: token.current, marks, generation: generation.current });
        if (runId.current !== id) {
          forget((raw as { token?: string } | null)?.token ?? null);
          return;
        }
        const r = checked(validateStatementReview, raw);
        token.current = r.token;
        // The app says which part it is showing now (it starts again at the first if the taught
        // reading has fewer parts than before).
        section.current = r.section_index;
        const stillFailing = r.activity_check.outcome === "failed" || r.holdings_check.outcome === "failed";
        if (stillFailing) attempts.current += 1;
        setPhase(stillFailing ? { kind: "teach", review: r, lines: phase.lines, attempts: attempts.current } : { kind: "review", review: r });
      }),
    [phase, run, forget, checked],
  );

  const finish = useCallback(
    (decisions: FinishDecisions) =>
      run(async (id) => {
        const finished = validateStatementFinished(
          await invoke("finish_statement_reconciliation", { token: token.current, decisions, generation: generation.current }),
        );
        if (runId.current !== id) return;
        token.current = null;
        setPhase({ kind: "done", finished });
      }),
    [run],
  );

  const cancel = useCallback(() => {
    runId.current += 1;
    working.current = false;
    const openToken = token.current;
    token.current = null;
    setBusy(false);
    setError(null);
    setPhase({ kind: "idle" });
    forget(openToken);
  }, [forget]);

  useEffect(
    () => () => {
      runId.current += 1;
      const openToken = token.current;
      token.current = null;
      if (openToken) {
        void Promise.resolve(invoke("cancel_statement_review", { token: openToken, generation: generation.current })).catch(() => {});
      }
    },
    [],
  );

  const backToReview = useCallback(() => {
    if (phase.kind === "teach") setPhase({ kind: "review", review: phase.review });
  }, [phase]);

  return { phase, error, busy, start, chooseSection, setFlip, openTeach, teach, finish, cancel, backToReview };
}
