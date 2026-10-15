import { useCallback, useEffect, useRef, useState } from "react";
import { createFinancialClient } from "../financialReads";
import { askVault, explainFailure, type AskVaultResult } from "./controller";
import type { AskPurchaseRow } from "./contract";
import type { ParseContext } from "./types";

type Client = ReturnType<typeof createFinancialClient>;
export type LegacyAnswer = { matched: boolean; answer: string };

export type AskVaultView =
  | { status: "idle" }
  | { status: "loading"; question: string }
  | { status: "answer"; question: string; result: Extract<AskVaultResult, { status: "answer" }> }
  | { status: "clarify"; question: string; reason: string; choices: string[]; replacements?: string[] }
  | { status: "unsupported"; question: string; reason: string }
  | { status: "legacy"; question: string; matched: boolean; answer: string }
  | { status: "stale"; question: string; message: string }
  | { status: "error"; question: string; message: string };

export type AskVaultDetails =
  | null
  | { status: "loading" }
  | { status: "ready"; rows: AskPurchaseRow[]; purchaseCount: number }
  | { status: "error"; message: string };

const DETAIL_ROWS = 50;
const LEDGER_CHANGED = "Your ledger changed. Ask again using the current data.";

/**
 * One question at a time against one open profile. The client lives exactly as long as the card is
 * mounted, so locking or switching profiles (which unmounts the Dashboard) releases it, and a reply
 * that arrives afterwards is never shown. Only the latest question may answer. An answer is retired,
 * not left on screen, when the data underneath it changes.
 */
export function useAskVault({
  getContext,
  legacyAsk,
  dataKey,
  reloadKey,
  createClient = createFinancialClient,
}: {
  /** Built when a question is asked, so today's date and the names are always current. */
  getContext: () => ParseContext;
  legacyAsk: (question: string) => LegacyAnswer;
  /** Changes whenever the ledger the Dashboard shows changes. */
  dataKey: unknown;
  /** Changes whenever the Dashboard reloads its list. An answer is kept if the native data revision is unchanged. */
  reloadKey?: unknown;
  createClient?: () => Pick<Client, "askVault" | "dispose">;
}) {
  const client = useRef<Pick<Client, "askVault" | "dispose"> | null>(null);
  const alive = useRef(false);
  // Plain counters (not DOM refs): bumping one invalidates any reply still in flight.
  const [tokens] = useState(() => ({ sequence: 0, detail: 0, check: 0 }));
  const factory = useRef(createClient);
  factory.current = createClient;
  const latest = useRef({ getContext, legacyAsk, dataKey, reloadKey });
  latest.current = { getContext, legacyAsk, dataKey, reloadKey };
  const answeredWith = useRef<unknown>(dataKey);
  const [view, setView] = useState<AskVaultView>({ status: "idle" });
  const shown = useRef(view);
  shown.current = view;
  const checkedFor = useRef<unknown>(reloadKey);
  const [details, setDetails] = useState<AskVaultDetails>(null);
  // The answer being re-checked after a reload. It is not shown (or its purchases listed) until the check says it is current.
  const [checking, setChecking] = useState<Extract<AskVaultView, { status: "answer" }>["result"] | null>(null);

  useEffect(() => {
    alive.current = true;
    client.current = factory.current();
    return () => {
      alive.current = false;
      tokens.sequence++;
      tokens.detail++;
      tokens.check++;
      client.current?.dispose();
      client.current = null;
    };
  }, [tokens]);

  useEffect(() => {
    setView((current) => {
      const showing = current.status === "answer" || current.status === "legacy";
      if (!showing || answeredWith.current === dataKey) return current;
      return { status: "stale", question: current.question, message: LEDGER_CHANGED };
    });
    if (answeredWith.current !== dataKey) {
      tokens.detail++; // a purchases list still being read must not open for an answer that is gone
      setDetails(null);
    }
  }, [dataKey, tokens]);

  /** Ask the native side whether its data revision moved since this answer was read; if it did (or the check fails), retire the answer. */
  const verifyFresh = useCallback(
    (answer: Extract<AskVaultView, { status: "answer" }>["result"]) => {
      if (!client.current) return;
      const mine = ++tokens.check;
      const day = answer.request.periods[0].from;
      tokens.detail++;
      setDetails(null);
      setChecking(answer);
      const retire = () => {
        if (!alive.current || mine !== tokens.check) return;
        setChecking(null);
        tokens.detail++; // and any purchases list still being read for it
        setView((now) => (now.status === "answer" && now.result === answer ? { status: "stale", question: now.question, message: LEDGER_CHANGED } : now));
        setDetails(null);
      };
      client.current
        .askVault({ kind: "total", periods: [{ from: day, to: day }], accountIds: [], categories: [], minimumPurchase: null, vendors: [], excludeVendors: [], excludeCategories: [], limit: 1, expectedRevision: null })
        .then((reply) => {
          if (reply.revision.local !== answer.revision.local || reply.revision.external !== answer.revision.external) retire();
          else if (alive.current && mine === tokens.check) setChecking((c) => (c === answer ? null : c));
        })
        .catch(retire);
    },
    [tokens],
  );

  // A reload of the list does not mean the data changed (and a split can change amounts without changing the
  // list's fingerprint), so check the data revision rather than trusting the list.
  useEffect(() => {
    if (reloadKey === checkedFor.current) return;
    checkedFor.current = reloadKey;
    const current = shown.current;
    if (current.status === "answer") verifyFresh(current.result);
  }, [reloadKey, verifyFresh]);

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || !client.current) return;
    const request = ++tokens.sequence;
    tokens.detail++;
    tokens.check++;
    setDetails(null);
    setChecking(null);
    answeredWith.current = latest.current.dataKey;
    const startedWith = { dataKey: latest.current.dataKey, reloadKey: latest.current.reloadKey };
    setView({ status: "loading", question });
    // Let the "working" state reach the screen before the question is read: with a large ledger that work is not instant.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!alive.current || request !== tokens.sequence) return;
    const outcome = await askVault(question, latest.current.getContext(), client.current);
    if (!alive.current || request !== tokens.sequence) return;
    switch (outcome.status) {
      case "answer":
        setView({ status: "answer", question, result: outcome });
        // The ledger changed while this was being read: it may already be out of date, so check before trusting it.
        if (latest.current.dataKey !== startedWith.dataKey || latest.current.reloadKey !== startedWith.reloadKey) verifyFresh(outcome);
        return;
      case "legacy": {
        const legacy = latest.current.legacyAsk(question);
        setView({ status: "legacy", question, matched: legacy.matched, answer: legacy.answer });
        return;
      }
      case "clarify":
        setView({ status: "clarify", question, reason: outcome.reason, choices: outcome.choices, replacements: outcome.replacements });
        return;
      case "unsupported":
        setView({ status: "unsupported", question, reason: outcome.reason });
        return;
      case "stale":
        setView({ status: "stale", question, message: outcome.message });
        return;
      case "error":
        setView({ status: "error", question, message: outcome.message });
    }
  }, [tokens, verifyFresh]);

  /** The purchases behind a total: the same filters, read as a ranking of up to 50 purchases. */
  const openDetails = useCallback(async () => {
    if (view.status !== "answer" || !client.current) return;
    const { request, revision } = view.result;
    const mine = ++tokens.detail;
    setDetails({ status: "loading" });
    try {
      const reply = await client.current.askVault({
        ...request,
        kind: "rank-purchases",
        periods: [request.periods[0]],
        limit: DETAIL_ROWS,
        expectedRevision: revision,
      });
      if (!alive.current || mine !== tokens.detail) return;
      setDetails({ status: "ready", rows: reply.periods[0].purchases, purchaseCount: reply.periods[0].purchaseCount });
    } catch (failure) {
      if (!alive.current || mine !== tokens.detail) return;
      setDetails({ status: "error", message: explainFailure(failure).message });
    }
  }, [view, tokens]);

  const closeDetails = useCallback(() => {
    tokens.detail++;
    setDetails(null);
  }, [tokens]);

  return { view, details, checking, ask, openDetails, closeDetails };
}
