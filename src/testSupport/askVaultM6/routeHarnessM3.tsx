import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { AskVaultCard } from "../../AskVaultCard";
import type { ParseContext } from "../../askVault/types";
import { canonical } from "./counting";
import type { CorpusCase, Observation, Requirement } from "./manifest";

/**
 * Public-route harness for the M3 spending what-if (task-4 item 6). Test-only; jsdom. It drives the real card with a case's own text under the origin-101 parse context, as the
 * Dashboard mounts it (a family list is always present). The native reply to the baseline read is the seed's native-validated baseline-shaped reference, chosen by the request the
 * CARD sent; any other read (the freshness check) gets an empty one-day snapshot, which the card only compares with its own data revision.
 * It follows the review the person consents to: when 1 or 2 complete months are all there is, it makes the explicit act of accepting the months there are, then confirms. The
 * Observation's request is the intent the review SHOWED (category, reduction, schedule, part-month rule), and its result is what the result screen SHOWED.
 */
const MONTH_NUMBER: Record<string, string> = { January: "01", February: "02", March: "03", April: "04", May: "05", June: "06", July: "07", August: "08", September: "09", October: "10", November: "11", December: "12" };
const iso = (text: string) => { const m = /([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(text)!; return `${m[3]}-${MONTH_NUMBER[m[1]]}-${m[2].padStart(2, "0")}`; };
const plain = (shown: string) => { const n = shown.replace(/[$,%]/g, ""); return n.includes(".") ? n.replace(/0+$/, "").replace(/\.$/, "") : n; };
const usd = (shown: string) => shown.replace(/[$,]/g, "");
const strip = (request: unknown) => { const { expectedRevision: _ignored, ...rest } = request as Record<string, unknown>; return rest; };

export function scrapeM3Review(text: string) {
  const category = /Category(.+?)Change/.exec(text), reduction = /Spend less by(\$[\d,]+\.\d{2}|[\d.]+%) (every month|once)/.exec(text);
  const range = /Dates([A-Za-z]+ \d{1,2}, \d{4}) to ([A-Za-z]+ \d{1,2}, \d{4})/.exec(text), single = /Date([A-Za-z]+ \d{1,2}, \d{4})Change/.exec(text), part = /Part months(.+?)Change/.exec(text);
  if (!category || !reduction || (!range && !single)) return null;
  const once = reduction[2] === "once";
  return { version: 1, category: category[1], reduction: { kind: reduction[1].endsWith("%") ? "percent" : "money", amount: plain(reduction[1]) }, cadence: once ? "once" : "monthly",
    horizon: once ? { kind: "prospective", from: iso(single![1]), to: iso(single![1]) } : { kind: "prospective", from: iso(range![1]), to: iso(range![2]) },
    partialMonth: once ? "none" : /Not counted/.test(part?.[1] ?? "") ? "exclude" : "prorate" };
}
export function scrapeM3Result(text: string) {
  const total = /would save(\$[\d,]+\.\d{2})/.exec(text), usual = /divided by how many there are: (\$[\d,]+\.\d{2}) a month/.exec(text), limit = /limit would be (\$[\d,]+\.\d{2}) a month/.exec(text);
  const table = /Month by monthMonthSaved((?:[A-Za-z]+ \d{4}\$[\d,]+\.\d{2})+)Total/.exec(text);
  const months = table ? [...table[1].matchAll(/([A-Za-z]+ \d{4})(\$[\d,]+\.\d{2})/g)].map(m => ({ month: m[1], saved: usd(m[2]) })) : [];
  if (!total || !usual) return null;
  return { outcome: "preview" as const, monthsUsed: [...text.matchAll(/\$[\d,]+\.\d{2}Counted/g)].length, usualMonth: usd(usual[1]), totalSaving: usd(total[1]), months, monthlyLimit: limit ? usd(limit[1]) : null };
}

export type M3Env = { index: Map<string, unknown>; parseContext: ParseContext };
export const m3IndexKey = (request: unknown) => canonical(strip(request));

export async function observeM3Case(c: CorpusCase, r: Requirement, env: (seed: number) => M3Env): Promise<Observation> {
  const { index, parseContext } = env(r.seed);
  const client = {
    askVault: vi.fn(async (request: { periods: { from: string; to: string }[] }) => {
      const value = index.get(m3IndexKey(request));
      if (value !== undefined) return { ...(value as object), context: { generation: 1, sessionRevision: 1 }, revision: { local: 1, external: 1 } };
      const p = request.periods[0];
      return { contractVersion: 1, context: { generation: 1, sessionRevision: 1 }, revision: { local: 1, external: 1 }, asOf: parseContext.today, kind: "total", spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount", difference: null,
        periods: [{ from: p.from, to: p.to, dayCount: 1, endsToday: true, historyCoverage: "unknown", total: "0.00", purchaseCount: 0, categoryCount: 0, categories: [], purchases: [], vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0.00", purchaseCount: 0, vendors: [], categories: [] } }] };
    }),
    askVaultBaselines: vi.fn(async () => { throw new Error("not exercised"); }), dispose: vi.fn(),
    askVaultRetirementAccounts: vi.fn(async () => { throw new Error("not exercised"); }), askVaultRetirementContext: vi.fn(async () => { throw new Error("not exercised"); }),
  };
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const base = { caseId: c.id, seed: r.seed, contextId: r.contextId, accepted: [] as Observation["accepted"], reviewed: false, consented: false };
  try {
    act(() => root.render(<AskVaultCard getContext={() => parseContext} legacyAsk={() => ({ matched: false, answer: "I can't answer that." })} dataKey="m3" reloadKey="m3" accountNames={new Map()} createClient={() => client as never} />));
    const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, c.text); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle(); await settle();
    const dialog = () => document.querySelector('[role="dialog"]');
    const clarify = container.querySelector(".ledger-qa-clarify");
    if (clarify && !dialog()) { const labels = [...clarify.querySelectorAll("button")].map(b => b.textContent ?? ""); return { ...base, stage: "clarify", meaningChoices: labels.length, offeredChoices: labels }; }
    const d = dialog();
    if (!d) return { ...base, stage: "refusal", meaningChoices: 0 };
    const review = scrapeM3Review(d.textContent ?? "");
    if (!review) return { ...base, stage: "refusal", meaningChoices: 0 };
    const accept = [...d.querySelectorAll("label")].find(l => /^Use the \d+ months I have/.test(l.textContent ?? ""));
    if (accept) { await act(async () => accept.querySelector<HTMLInputElement>("input")!.click()); await settle(); }
    const button = [...d.querySelectorAll("button")].find(b => b.textContent === "Show what I would save") as HTMLButtonElement | undefined;
    if (!button || button.disabled) return { ...base, stage: "draft", meaningChoices: 0, reviewed: true };
    await act(async () => button.click()); await settle();
    const after = dialog()?.textContent ?? "";
    const result = scrapeM3Result(after);
    if (!result) return { ...base, stage: /too large|larger than/i.test(after) ? "refusal" : "error", meaningChoices: 0, reviewed: true, consented: true };
    return { ...base, stage: "result", meaningChoices: 0, reviewed: true, consented: true, request: review, result, accepted: [{ request: review, result }] };
  } finally {
    act(() => root.unmount()); container.remove(); document.body.innerHTML = "";
  }
}
