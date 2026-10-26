import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { vi } from "vitest";
import type { CutPreviewDialogProps, CutPreviewScreen } from "../../CutPreviewDialog";
import type { ParseContext } from "../../askVault/types";
import { validateBaselineBatchSnapshot } from "../../askVault/cutPreviewBatch";
import { baselineRequest } from "../../askVault/spendingScenarioBaseline";
import { canonical } from "./counting";
import { SOURCE, m4DisplayMoney, type M4Row } from "./m4Scenario";

// Transparent observation tap: original dialog renders and all original handlers execute. No state/result injection.
const tap = vi.hoisted(() => ({ screen: null as CutPreviewScreen | null }));
vi.mock("../../CutPreviewDialog", async original => {
  const actual = await original<typeof import("../../CutPreviewDialog")>();
  return { ...actual, CutPreviewDialog: (p: CutPreviewDialogProps) => { tap.screen = p.screen; return createElement(actual.CutPreviewDialog, p); } };
});
import { AskVaultCard } from "../../AskVaultCard";

const DIR = "src/testSupport/askVaultM6";
const json = (f: string) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
const withoutRevision = (v: unknown) => { const { expectedRevision: _revision, ...rest } = v as Record<string, unknown>; return rest; };
export async function observeM4(row: M4Row, seed: number) {
  const all = json("scenarioNativeReferences.json").references as Record<string, { kind: string; worldId: string; requestId: string; value: object }>;
  const requests = json("scenarioNativeRequests.json"), worldId = `origin-101-seed-${seed}`;
  const index = new Map(Object.values(all).filter(r => r.kind === "baseline" && r.worldId === worldId).map(r => [canonical(withoutRevision(requests[r.requestId])), r.value]));
  const context = { ...json("contexts.json").contexts[`m1-origin-101-seed-${seed}`].parseContext, familyMembers: [] } as ParseContext;
  const withSource = (v: object) => ({ ...v, context: { generation: SOURCE.generation, sessionRevision: SOURCE.sessionRevision }, revision: { ...SOURCE.revision } });
  const client = {
    askVault: vi.fn(async (req: { periods: { from: string; to: string }[]; contractVersion?: number }) => {
      if (req.contractVersion) throw Error("Unexpected non-batch baseline read");
      const p = req.periods[0];
      if (p.from !== SOURCE.asOf || p.to !== SOURCE.asOf) throw Error("Unexpected freshness read");
      return withSource({ contractVersion: 1, asOf: SOURCE.asOf, kind: "total", spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount", difference: null,
        periods: [{ ...p, dayCount: 1, endsToday: true, historyCoverage: "unknown", total: "0.00", purchaseCount: 0, categoryCount: 0, categories: [], purchases: [], vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0.00", purchaseCount: 0, vendors: [], categories: [] } }] });
    }),
    askVaultBaselines: vi.fn(async (req: Parameters<typeof validateBaselineBatchSnapshot>[1]) => {
      const baselines = req.categories.map(category => {
        const snapshot = index.get(canonical(withoutRevision(baselineRequest(category, SOURCE.asOf, req.expectedRevision))));
        if (!snapshot) throw Error("No native reference for actual requested category");
        return { category, snapshot: withSource(snapshot) };
      });
      return validateBaselineBatchSnapshot(withSource({ contractVersion: 1, asOf: SOURCE.asOf, baselines }), req);
    }),
    dispose: vi.fn(), askVaultRetirementAccounts: vi.fn(async () => { throw Error("Unexpected retirement read"); }), askVaultRetirementContext: vi.fn(async () => { throw Error("Unexpected retirement read"); }),
  };
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  tap.screen = null;
  const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const click = async (text: string) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text);
    if (!b || b.disabled) throw Error(`Missing/disabled ${text}: ${document.body.textContent}`);
    await act(async () => b.click()); await settle();
  };
  try {
    act(() => root.render(<AskVaultCard getContext={() => context} legacyAsk={() => ({ matched: false, answer: "Not a legacy question" })} dataKey="m4" reloadKey="m4" accountNames={new Map()} createClient={() => client as never} />));
    const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, row.text); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    await click("Review the details");
    for (const label of [...document.querySelectorAll("label")].filter(l => /^Use \d+ recorded months? for /.test(l.textContent ?? ""))) {
      await act(async () => label.querySelector<HTMLInputElement>("input")!.click()); await settle();
    }
    const beforeConsent = document.body.textContent?.includes("Your savings target preview") ?? false;
    await click("Show the preview");
    const screen = tap.screen as CutPreviewScreen | null;
    if (screen?.stage !== "result") throw Error(`Expected result: ${document.body.textContent}`);
    const { scenario, ...result } = screen.calculation;
    const displayProblems: string[] = [], text = document.querySelector('[role="dialog"]')!.textContent ?? "";
    for (const amount of [result.targetCents, result.allocatedCents, result.maximumCents, result.shortfallCents]) if (!text.includes(m4DisplayMoney({ numerator: amount, denominator: "100" }))) displayProblems.push(`Missing headline ${amount}`);
    if (!text.includes(m4DisplayMoney(result.totalSaving))) displayProblems.push("Missing exact-period total");
    const shownRows = [...document.querySelectorAll(".cut-preview-results tbody tr")].map(tr => [...tr.querySelectorAll("th,td")].map(c => c.textContent));
    const expectedRows = result.allocations.map(a => [a.category, m4DisplayMoney({ numerator: a.allocatedCents, denominator: "100" }), m4DisplayMoney(a.monthlyReduction), m4DisplayMoney(a.monthlyLimit)]);
    if (canonical(shownRows) !== canonical(expectedRows)) displayProblems.push("Category row/order/amount mismatch");
    for (const a of result.allocations) for (const i of a.intervals) if (!text.includes(m4DisplayMoney(i.saving))) displayProblems.push(`Missing interval saving ${a.category}/${i.from}`);
    return { beforeConsent, request: scenario.intent, result, displayProblems };
  } finally { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; }
}
