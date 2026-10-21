// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AskVaultCard } from "../AskVaultCard";
import { answerLedgerQuestion, type QaContext } from "../ledgerQa";
import { LEGACY_PROFILE } from "../testSupport/askVaultM6/exampleMap";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { RETIREMENT_CORPUS } from "./retirementCorpus";
import type { RoutingObservation } from "../testSupport/askVaultM6/manifest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type RouteCase = { id: string; text: string; family: string; expectedRoute: string };
const cases: RouteCase[] = JSON.parse(readFileSync("src/testSupport/askVaultM6/routingCases.json", "utf8"));
const grade = (routingObservations: RoutingObservation[]) => gradeCorpus({ cases: [], requests: {}, references: {}, observations: [], requiredFamilies: [...REQUIRED_FAMILY_IDS],
  evidence: { kind: "corpus", proofs: {}, manifest: { proofs: {}, identities: {} }, contexts: { worlds: {}, contexts: {} } }, routingObservations });
/** M5 retirementScoringPlan routeNonInterference: these are routing obligations, not supported financial-completion or ambiguity populations. */
describe("M5 non-interference and unsupported follow-up routing", () => {
  it("preserves every original routing text and family, with no extra financial credit", () => {
    const originals = RETIREMENT_CORPUS.filter(c => ["route-elsewhere", "follow-up"].includes(c.family));
    expect(cases.map(c => [c.id, c.text, c.family])).toEqual(originals.map(c => [c.id, c.text, `m5:${c.family}`]));
  });
  it("requires every designated routing case, rejects missing, duplicated, wrong routes and retirement claims", () => {
    const observations = cases.map(c => ({ caseId: c.id, actualRoute: c.expectedRoute, retirementReads: 0 }));
    const good = grade(observations);
    expect(good.families.filter(f => f.outcomes.includes("routing")).map(f => f.status)).toEqual(["PASS", "PASS"]);
    expect(good.financialTexts).toBe(0); expect(good.core.total).toBe(0);
    for (const bad of [observations.slice(1), [...observations, observations[0]], observations.map((o, i) => i ? o : { ...o, actualRoute: "retirement" }), observations.map((o, i) => i ? o : { ...o, retirementReads: 1 })]) {
      expect(grade(bad).families.some(f => f.outcomes.includes("routing") && f.status !== "PASS")).toBe(true);
    }
  });
  it.each(cases)("$id reaches the declared older route without any retirement read or illustration", async c => {
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
    const client = { askVault: vi.fn(async () => { throw Error("Routing-only check: no financial result is certified"); }), askVaultBaselines: vi.fn(), dispose: vi.fn(), askVaultRetirementAccounts: vi.fn(), askVaultRetirementContext: vi.fn() };
    const legacyContext = { ...LEGACY_PROFILE, categories: [], today: new Date(...LEGACY_PROFILE.today) } as unknown as QaContext;
    const legacy = vi.fn((q: string) => answerLedgerQuestion(q, legacyContext));
    try {
      act(() => root.render(<AskVaultCard getContext={() => ({ today: "2026-09-06", historyStart: "2025-01-01", categories: ["Dining", "Shopping", "Retirement Gifts"], accounts: [{ id: 5, name: "Roth IRA" }], investmentAccounts: [{ id: 5, name: "Roth IRA" }], merchants: [], familyMembers: [] })}
        legacyAsk={legacy} dataKey="route" reloadKey="route" accountNames={new Map()} createClient={() => client as never} />));
      const field = container.querySelector<HTMLInputElement>("input")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, c.text); field.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      const text = document.body.textContent ?? "";
      const actualRoute = client.askVault.mock.calls.length ? "ordinary" : legacy.mock.calls.length ? "legacy" : text.includes("Where would you like to cut back?") ? "m4" : text.includes("Before I work this out") && document.querySelector('[role="dialog"]') ? "m3" : container.querySelector(".ledger-qa-hint") ? "ordinary-refusal" : "unclaimed";
      expect(actualRoute, text).toBe(c.expectedRoute);
      expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(client.askVaultRetirementContext).not.toHaveBeenCalled();
      expect(text).not.toContain("Illustrative balance");
    } finally { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; }
  });
});
