// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard } from "../AskVaultCard";
import { parseQuestion } from "./parser";
import type { ParseContext } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// CG-21 cell C6 / nominated check N-1 (Requirements-Checklist.md CG-21; owner instruction 2026-10-21, Task-Authority-2.txt:148-160): the 108 M1 legacy prompts, through the real card.
// Each must reach the older matcher (the card's legacyAsk) exactly once with the original text, cause no native read of any kind, and show the older matcher's answer.
type Row = { id: string; world: number; contextId: string; text: string; family: string };
type Fixture = { provenance: { count: number; distinctTexts: number; sha256: Record<string, string>; supersededByM2: { ids: string[]; count: number; authority: string } }; cases: Row[] };
const R = "src/testSupport/askVaultM6/";
const fixture = JSON.parse(readFileSync(R + "legacyHandoff.json", "utf8")) as Fixture;
const m2Owned = new Set(fixture.provenance.supersededByM2.ids);
const handedOver = fixture.cases.filter(c => !m2Owned.has(c.id));
const contexts = JSON.parse(readFileSync(R + "contexts.json", "utf8")) as { contexts: Record<string, { parseContext: ParseContext }> };
const appContext = (id: string): ParseContext => { const stored = contexts.contexts[id].parseContext; return stored.familyMembers !== undefined ? stored : { ...stored, familyMembers: [] }; };

let container: HTMLDivElement, root: Root;
const reads = { askVault: vi.fn(), baselines: vi.fn(), accounts: vi.fn(), context: vi.fn() };
const client = () => ({ askVault: reads.askVault, askVaultBaselines: reads.baselines, askVaultRetirementAccounts: reads.accounts, askVaultRetirementContext: reads.context, dispose: vi.fn() });
const legacy = vi.fn((question: string) => ({ matched: true, answer: `Older answer for: ${question}` }));
beforeEach(() => { vi.clearAllMocks(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; });
async function ask(contextId: string, text: string) {
  act(() => root.render(<AskVaultCard getContext={() => appContext(contextId)} legacyAsk={legacy} dataKey="legacy" reloadKey="legacy" accountNames={new Map()} createClient={() => client() as never} />));
  const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, text); box.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe("the legacy hand-off fixture keeps its provenance", () => {
  it("holds the 108 original prompts, uniquely identified, each in a context that exists", () => {
    expect(fixture.cases).toHaveLength(108);
    expect(fixture.provenance.count).toBe(108);
    expect(new Set(fixture.cases.map(c => c.id)).size).toBe(108);
    expect(new Set(fixture.cases.map(c => c.text)).size).toBe(fixture.provenance.distinctTexts);
    expect(Object.keys(fixture.provenance.sha256).sort()).toEqual(["acceptance.test.ts", "generate.ts", "world.ts"]);
    for (const c of fixture.cases) expect(contexts.contexts[c.contextId], c.id).toBeDefined();
  });
  it("is what the parser hands to the older matcher in M1 mode, and in the shipped app mode for all but the six averages that M2 took over", () => {
    for (const c of fixture.cases) expect(parseQuestion(c.text, contexts.contexts[c.contextId].parseContext).status, c.id).toBe("legacy");
    expect(handedOver).toHaveLength(102);
    expect(fixture.provenance.supersededByM2.count).toBe(6);
    expect(fixture.cases.filter(c => m2Owned.has(c.id)).every(c => c.family === "average")).toBe(true);
    for (const c of handedOver) expect(parseQuestion(c.text, appContext(c.contextId)).status, c.id).toBe("legacy");
    for (const c of fixture.cases.filter(c => m2Owned.has(c.id))) expect(parseQuestion(c.text, appContext(c.contextId)).status, c.id).not.toBe("legacy");
  });
});

describe("each of the 102 legacy prompts that the shipped app still hands over, through the real card", () => {
  it.each(handedOver.map(c => [c.id, c] as const))("%s", async (_id, c) => {
    await ask(c.contextId, c.text);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledWith(c.text);
    expect(reads.askVault).not.toHaveBeenCalled();
    expect(reads.baselines).not.toHaveBeenCalled();
    expect(reads.accounts).not.toHaveBeenCalled();
    expect(reads.context).not.toHaveBeenCalled();
    expect(container.querySelector(".ledger-qa-answer")?.textContent).toBe(`Older answer for: ${c.text}`);
    expect(container.querySelector(".ledger-qa-clarify")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it.each(fixture.cases.filter(c => m2Owned.has(c.id)).map(c => [c.id, c] as const))("%s is an M2 average question: the older matcher is not asked", async (_id, c) => {
    await ask(c.contextId, c.text);
    expect(legacy).not.toHaveBeenCalled();
    if (c.text.startsWith("average monthly")) {
      expect(reads.askVault).toHaveBeenCalledTimes(1);
      expect(reads.askVault.mock.calls[0][0]).toMatchObject({ average: "per-month" });
    } else {
      expect([...container.querySelectorAll(".ledger-qa-clarify button")].map(b => b.textContent)).toEqual(["Per purchase", "Per month"]);
      expect(reads.askVault).not.toHaveBeenCalled();
    }
  });
  it("editing the question changes the older matcher's input and the displayed answer", async () => {
    const [a, b] = [fixture.cases.find(c => c.text === "net worth")!, fixture.cases.find(c => c.text !== "net worth" && c.world === 101)!];
    await ask(a.contextId, a.text);
    expect(container.querySelector(".ledger-qa-answer")?.textContent).toBe(`Older answer for: ${a.text}`);
    await ask(a.contextId, b.text);
    expect(legacy).toHaveBeenLastCalledWith(b.text);
    expect(container.querySelector(".ledger-qa-answer")?.textContent).toBe(`Older answer for: ${b.text}`);
    expect(reads.askVault).not.toHaveBeenCalled();
  });
});
