import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { AskVaultCard } from "../../AskVaultCard";
import type { ParseContext } from "../../askVault/types";
import { canonical } from "./counting";
import { expectedTables, readTables, rowProblems, summaryProblems, type ReplyValue } from "./displayCheck";
import type { CorpusCase, Observation, Requirement, ResolutionObservation } from "./manifest";

/**
 * Combined public-route harness (Validation-Plan VP-06; task-4 item 6). Test-only; needs jsdom.
 * It drives the REAL Ask the Vault card (real parsers, controllers and rendering) with a case's own text under the case's own frozen parse context,
 * and turns what the card did into a grader `Observation`:
 *  - the native reply is whatever frozen reference matches the request the CARD actually sent (context + canonical request). The harness never looks up the
 *    case's expected reference, so a wrong request gets no answer ("error"), not a borrowed one;
 *  - the answer counts only if the card DISPLAYS the reply faithfully: every ranked or broken-down row in order with its label, amount and detail (opening
 *    "Show all" when the list is longer than the inline rows), the headline total and purchase count, and both totals and the difference of a comparison
 *    (`displayCheck.ts`). Any problem marks the result `displayMismatch`, which the grader treats as a wrong acceptance;
 *  - a clarification card gives `clarify` and the exact choice labels; with `choose`, the named choice is clicked and the completed answer is observed with
 *    one meaning clarification; a message, suggestions or an unmatched answer give `refusal`; a dialog gives `draft`.
 * It is a harness for the ordinary spending route. Scenario families (M3/M4/M5) need native per-seed fixtures and are not exercised here.
 */
export type RouteEnv = {
  contexts: { contexts: Record<string, { parseContext: unknown }> };
  requests: Record<string, unknown>;
  references: Record<string, { value: unknown; contextId: string; requestId: string }>;
};
const withoutRevision = (request: unknown) => { const { expectedRevision: _ignored, ...rest } = request as Record<string, unknown>; return rest; };
const key = (contextId: string, request: unknown) => `${contextId}|${canonical(withoutRevision(request))}`;
export function buildReplyIndex(env: Pick<RouteEnv, "requests" | "references">): Map<string, unknown> {
  const index = new Map<string, unknown>();
  for (const ref of Object.values(env.references)) {
    const request = env.requests[ref.requestId];
    if (request !== undefined) index.set(key(ref.contextId, request), ref.value);
  }
  return index;
}

/**
 * `app` (default) mounts the card the way the shipped Dashboard does: the parse context always carries a family list, possibly empty (src/DashboardView.tsx:321-322),
 * which the parser reads as the M2 context (src/askVault/parser.ts:994). `frozen` uses the stored context unchanged; the stored M1-era contexts have no family list,
 * a context the shipped app never builds, and the parser keeps its deliberate M1-mode refusals there (for example a threshold inside a comparison).
 * `choose` picks one of the offered choice labels (or none) after a first clarification.
 */
export type RouteOptions = { contextMode?: "app" | "frozen"; choose?: (labels: string[]) => string | null };
const INLINE_ROWS = 5;

/** Every display problem for a reply the card has rendered under `card`; opens "Show all" when the list is longer than the inline rows. */
export async function checkDisplay(value: ReplyValue, card: Element): Promise<string[]> {
  const answer = card.querySelector(".ledger-qa-answer") ?? card;
  const problems = summaryProblems(value, answer);
  const expected = expectedTables(value), shown = readTables(answer);
  if (shown.length !== expected.length) problems.push(`shows ${shown.length} lists or tables, expected ${expected.length}`);
  for (let t = 0; t < Math.min(expected.length, shown.length); t++) {
    const want = expected[t], got = shown[t], name = want.heading ?? "list";
    if (want.heading !== null && got.heading !== want.heading) problems.push(`${name}: heading "${got.heading}"`);
    if (t > 0 || want.rows.length <= INLINE_ROWS) { problems.push(...rowProblems(want.rows, got.rows).map(p => `${name} ${p}`)); continue; }
    problems.push(...rowProblems(want.rows.slice(0, INLINE_ROWS), got.rows.slice(0, INLINE_ROWS)).map(p => `inline ${name} ${p}`));
    if (got.rows.length > INLINE_ROWS) problems.push(`${name} shows ${got.rows.length} rows inline, the card shows at most ${INLINE_ROWS}`);
    const more = [...answer.querySelectorAll("button")].find(b => b.textContent === `Show all ${want.rows.length}`);
    if (!more) { problems.push(`no "Show all ${want.rows.length}" button`); continue; }
    await act(async () => more.click());
    const dialog = document.querySelector('[role="dialog"]');
    problems.push(...(dialog ? rowProblems(want.rows, readTables(dialog)[0]?.rows ?? []).map(p => `full list ${p}`) : ["Show all opened no list"]));
  }
  return problems;
}

/** An observation that also says which choice was clicked and how many native reads had happened before the click (D-R2: a store typo is never answered without a choice). */
export type ClickedObservation = Observation & Partial<Pick<ResolutionObservation, "chosen" | "readsBeforeChoice">>;
export async function observeCase(c: CorpusCase, r: Requirement, env: RouteEnv, index: Map<string, unknown>, options: RouteOptions = {}): Promise<ClickedObservation> {
  const calls: unknown[] = [];
  const client = {
    askVault: vi.fn(async (request: unknown) => {
      calls.push(request);
      const value = index.get(key(r.contextId, request));
      if (value === undefined) throw new Error("no frozen native reply for the request the card sent");
      return { ...(value as object), context: { generation: 1, sessionRevision: 1 }, revision: { local: 1, external: 1 } };
    }),
    askVaultBaselines: vi.fn(async () => { throw new Error("not exercised by the ordinary-route harness"); }), dispose: vi.fn(),
    askVaultRetirementAccounts: vi.fn(async () => { throw new Error("not exercised by the ordinary-route harness"); }),
    askVaultRetirementContext: vi.fn(async () => { throw new Error("not exercised by the ordinary-route harness"); }),
  };
  const stored = env.contexts.contexts[r.contextId].parseContext as ParseContext;
  const parseContext: ParseContext = options.contextMode === "frozen" || stored.familyMembers !== undefined ? stored : { ...stored, familyMembers: [] };
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  try {
    act(() => root.render(<AskVaultCard getContext={() => parseContext} legacyAsk={() => ({ matched: false, answer: "I can't answer that." })} dataKey="route" reloadKey="route" accountNames={new Map()} createClient={() => client as never} />));
    const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, c.text); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
    const card = container.querySelector(".ledger-qa-card")!;
    const base = { caseId: c.id, seed: r.seed, contextId: r.contextId, accepted: [] as Observation["accepted"], reviewed: false, consented: false };
    if (document.querySelector('[role="dialog"]')) return { ...base, stage: "draft", meaningChoices: 0 };
    let clarify = card.querySelector(".ledger-qa-clarify"), chosen = 0, offered: string[] | undefined, clicked: { chosen: string; readsBeforeChoice: number } | undefined;
    if (clarify) {
      const labels = [...clarify.querySelectorAll("button")].map(b => b.textContent ?? "");
      const pick = options.choose?.(labels) ?? null;
      if (pick === null) return { ...base, stage: "clarify", meaningChoices: 1, offeredChoices: labels };
      const button = [...clarify.querySelectorAll("button")].find(b => b.textContent === pick);
      if (!button) return { ...base, stage: "error", meaningChoices: 1, offeredChoices: labels };
      offered = labels; chosen = 1; clicked = { chosen: pick, readsBeforeChoice: calls.length };
      await act(async () => button.click()); await settle();
      clarify = card.querySelector(".ledger-qa-clarify");
      if (clarify) return { ...base, ...clicked, stage: "clarify", meaningChoices: 2, offeredChoices: [...clarify.querySelectorAll("button")].map(b => b.textContent ?? "") };
    }
    if (card.querySelector(".ledger-qa-headline") && calls.length) {
      const request = calls[calls.length - 1];
      const value = index.get(key(r.contextId, request)) as ReplyValue;
      const problems = await checkDisplay(value, card);
      const result = problems.length ? { ...value, displayMismatch: problems } : value;
      return { ...base, ...clicked, stage: "result", meaningChoices: chosen, offeredChoices: offered, request, result, accepted: [{ request, result }] };
    }
    if (card.querySelector(".ledger-qa-banner-error")) return { ...base, ...clicked, stage: "error", meaningChoices: chosen };
    return { ...base, ...clicked, stage: calls.length ? "error" : "refusal", meaningChoices: chosen };
  } finally {
    act(() => root.unmount()); container.remove(); document.body.innerHTML = "";
  }
}
