// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AskVaultCard } from "../AskVaultCard";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DIR = "src/testSupport/askVaultM6";
const cases: (CorpusCase & { flow: "m3" | "m4"; complete: number })[] = JSON.parse(readFileSync(`${DIR}/historyCases.json`, "utf8"));
const grade = (observations: Observation[]) => gradeCorpus({ cases, requests: {}, references: {}, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs: {}, manifest: { proofs: {}, identities: {} }, contexts: { worlds: {}, contexts: {} } } });
/** VP-04 P-ID: explicit history decision is a safe outcome, never a financial completion or invented zero. Synthetic protocol fixtures, not native proof. */
describe("P-ID recorded corpus and detection", () => {
  it("includes zero, one and two complete months in both baseline-using flows", () => {
    expect(cases.map(c => [c.flow, c.complete])).toEqual([["m3", 0], ["m3", 1], ["m3", 2], ["m4", 0], ["m4", 1], ["m4", 2]]);
  });
  it("grades an explicit history choice without granting financial or direct credit, and rejects an arbitrary draft", () => {
    const observed = cases.map(c => ({ caseId: c.id, seed: 101, contextId: c.required[0].contextId, stage: "history-choice", meaningChoices: 0, accepted: [], reviewed: true, consented: false } as Observation));
    const g = grade(observed);
    expect(g.requiredStops).toEqual({ total: 2, failed: 0 }); expect(g.financialTexts).toBe(0); expect(g.wrongAccepted).toEqual([]);
    expect(grade(observed.map(o => ({ ...o, stage: "draft" }))).requiredStops.failed).toBe(2);
    expect(grade(observed.map(o => ({ ...o, stage: "result", request: {}, result: { saving: "0" }, accepted: [{ request: {}, result: { saving: "0" } }] }))).wrongAccepted).toHaveLength(6);
  });
  it.each(cases)("$id reaches the actual history controls, blocks calculation, then changes output after an explicit user baseline/acceptance", async c => {
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
    const revision = { local: 1, external: 1 }, today = "2026-10-20";
    const months = ["07", "08", "09"].map((m, i) => ({ month: `2026-${m}`, from: `2026-${m}-01`, to: `2026-${m}-${m === "09" ? 30 : 31}`, dayCount: m === "09" ? 30 : 31,
      coverage: i < c.complete ? "complete" : "no-records", recordCount: i < c.complete ? 1 : 0, total: i < c.complete ? "300.00" : "0.00", purchaseCount: i < c.complete ? 1 : 0 }));
    const baseline = { contractVersion: 2, context: { generation: 1, sessionRevision: 1 }, revision, asOf: today, kind: "total", spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount", difference: null, comparison: null, earliestRecord: "2025-01-01",
      periods: [{ from: "2026-07-01", to: "2026-09-30", dayCount: 92, endsToday: false, historyCoverage: "unknown", total: `${c.complete * 300}.00`, purchaseCount: c.complete, categoryCount: c.complete ? 1 : 0, categories: [], purchases: [], vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0.00", purchaseCount: 0, vendors: [], categories: [] }, categoryTotals: [], memberTotals: [], sharedPurchaseCount: 0, recordedFrom: "2025-01-01", recordedThrough: today,
        average: { basis: "per-month", numerator: `${c.complete * 300}.00`, denominator: c.complete, value: c.complete ? "300.00" : null, unavailable: c.complete ? null : "no-complete-months", monthsUsed: months.filter(m => m.coverage === "complete").map(m => m.month), monthsLeftOut: months.filter(m => m.coverage !== "complete").map(m => ({ month: m.month, why: m.coverage })) }, months }] };
    const client = { askVault: vi.fn(async (q: { contractVersion?: number; periods: { from: string; to: string }[] }) => q.contractVersion ? baseline : { ...baseline, contractVersion: 1, periods: [{ ...baseline.periods[0], ...q.periods[0] }] }),
      askVaultBaselines: vi.fn(async () => ({ contractVersion: 1, context: baseline.context, revision, asOf: today, baselines: [{ category: "Groceries", snapshot: baseline }] })), dispose: vi.fn(), askVaultRetirementAccounts: vi.fn(), askVaultRetirementContext: vi.fn() };
    const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const click = async (text: string) => { const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!; expect(b, document.body.textContent ?? "").toBeTruthy(); expect(b.disabled).toBe(false); await act(async () => b.click()); await settle(); };
    try {
      act(() => root.render(<AskVaultCard getContext={() => ({ today, categories: ["Groceries"], accounts: [], merchants: [], familyMembers: [] })} legacyAsk={() => ({ matched: false, answer: "No answer" })} dataKey="history" reloadKey="history" accountNames={new Map()} createClient={() => client as never} />));
      const box = container.querySelector<HTMLInputElement>("input")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, c.text); box.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
      if (c.flow === "m4") await click("Review the details");
      const confirmText = c.flow === "m3" ? c.complete ? "Show what I would save" : "Use this amount" : "Show the preview";
      const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === confirmText)!;
      expect(confirm, document.body.textContent ?? "").toBeTruthy();
      if (c.complete || c.flow === "m4") expect(confirm.disabled).toBe(true);
      else { await click(confirmText); expect(document.querySelector('[aria-invalid="true"]')).toBeTruthy(); }
      expect(document.body.textContent).not.toMatch(/What you would save|Your savings target preview/);
      if (c.complete) {
        const label = [...document.querySelectorAll("label")].find(l => /^Use (the )?\d+ (recorded )?months?/.test(l.textContent ?? ""))!;
        expect(label).toBeTruthy(); await act(async () => label.querySelector<HTMLInputElement>("input")!.click()); await settle();
      } else {
        const field = document.querySelector<HTMLInputElement>(c.flow === "m4" ? 'input[aria-label="Groceries usual month"]' : 'input[aria-label="Your usual month"]') ?? [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].find(i => i.type !== "radio" && i.type !== "checkbox");
        expect(field).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "300"); field!.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
      }
      await click(confirmText);
      expect(document.body.textContent).toContain("$100.00");
      expect(document.body.textContent).toContain(c.flow === "m3" ? "What you would save" : "Your savings target preview");
    } finally { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; }
  });
});
