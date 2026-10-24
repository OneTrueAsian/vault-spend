// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard } from "../AskVaultCard";
import { EXAMPLE_PARSE_CONTEXT, EXAMPLE_WORLD } from "../testSupport/askVaultM6/exampleMap";
import { answer, request as oracleRequest } from "../testSupport/askVaultM6/referenceOracle";
import type { ParseContext } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Owner decision Q1 (21 October 2026): the existing bounds are kept and recorded per entity class (typoRules.json). This file proves (1) every recorded source line still holds
 * the rule it is cited for, and (2) the behavior of each class through the real card, including that nothing was widened: the bounds are probed one step past their edge,
 * stores always ask, an investment account is never answered from a typo and no alias works. Characterization tests: they passed against the unchanged parsers.
 */
const rules = JSON.parse(readFileSync("src/testSupport/askVaultM6/typoRules.json", "utf8")) as { sources: { class: string; file: string; line: number; snippet: string }[]; classes: Record<string, unknown> };
describe("typoRules.json cites lines that still hold the rules", () => {
  it("covers the three classes separately", () => { expect(Object.keys(rules.classes).sort()).toEqual(["investment-account", "ordinary-entity", "store"]); expect([...new Set(rules.sources.map(s => s.class))].sort()).toEqual(["investment-account", "ordinary-entity", "store"]); });
  it.each(rules.sources.map(s => [`${s.file}:${s.line}`, s] as const))("%s", (_name, s) => {
    const lines = readFileSync(s.file, "utf8").split(/\r?\n/);
    expect(lines[s.line - 1], `${s.file}:${s.line}`).toContain(s.snippet);
  });
});

let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
const ctx = { ...EXAMPLE_PARSE_CONTEXT, investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "Brokerage" }] } as unknown as ParseContext;
async function ask(question: string) {
  const askVault = vi.fn(async (req: Record<string, unknown>) => {
    const { contractVersion: _v, ...rest } = req;
    return { ...answer(EXAMPLE_WORLD, oracleRequest({ ...(rest as unknown as Parameters<typeof oracleRequest>[0]), members: (req.members as never) ?? { ids: [], unassigned: false } })), revision: { local: 1, external: 1 } };
  });
  const roster = vi.fn(async () => { throw new Error("stop"); });
  const client = { askVault, askVaultBaselines: vi.fn(), dispose: vi.fn(), askVaultRetirementAccounts: roster, askVaultRetirementContext: vi.fn() };
  act(() => root.render(<AskVaultCard getContext={() => ctx} legacyAsk={() => ({ matched: false, answer: "no" })} dataKey="t" reloadKey="t" accountNames={new Map()} createClient={() => client as never} />));
  const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, question); box.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  const text = (container.textContent ?? "") + (document.querySelector('[role="dialog"]')?.textContent ?? "");
  const choices = [...container.querySelectorAll(".ledger-qa-clarify button, [role=dialog] .ledger-qa-choices button")].map(b => b.textContent);
  return { askVault, roster, text, choices };
}

describe("ordinary entities (categories, accounts, family members)", () => {
  it("a unique small slip answers, and the reading is disclosed", async () => {
    const r = await ask("how much did I spend on dinning out in July");
    expect(r.askVault).toHaveBeenCalledTimes(1); expect(r.text).toContain("I read “dinning out” as “Dining Out”."); expect(r.text).toContain("$95.00");
  });
  it("a slip close to two names asks, offers exactly those names, and reads nothing", async () => {
    const r = await ask("how much did I spend on dinning last month");
    expect(r.askVault).not.toHaveBeenCalled(); expect(r.text).toContain("Which one did you mean?"); expect([...r.choices].sort()).toEqual(["Dining", "Dining Out"]); expect(r.text).not.toMatch(/\$\d/);
  });
  it("two slips are one past the bound: not corrected, not guessed, nothing read", async () => {
    const r = await ask("how much did I spend on grocxriex last month");
    expect(r.askVault).not.toHaveBeenCalled(); expect(r.text).not.toContain("Groceries"); expect(r.text).not.toMatch(/\$\d/);
  });
});

describe("stores", () => {
  it("a typo of a store always asks, even with one candidate, and reads nothing first", async () => {
    const r = await ask("how much did I spend at Wohle foods last month");
    expect(r.askVault).not.toHaveBeenCalled(); expect(r.text).toContain("Did you mean one of these?"); expect(r.choices.map(c => String(c).toLowerCase())).toEqual(["whole foods market"]);
  });
  it("one past the store bound (a 7-letter first word, tolerance 2, with 3 slips from the recorded first word) is not found, with no candidate", async () => {
    const r = await ask("how much did I spend at Costxxx last month");
    expect(r.askVault).not.toHaveBeenCalled(); expect(r.text).toContain("I couldn't find a store or payee called"); expect(r.choices).toEqual([]);
  });
  it("a name that starts a recorded name matches without any question", async () => {
    const r = await ask("how much did I spend at Whole last month");
    expect(r.askVault).toHaveBeenCalledTimes(1); expect(r.choices).toEqual([]);
  });
});

describe("investment accounts (M5)", () => {
  const Q = (name: string) => `Extra $50 a month into my ${name} until June 2050`;
  it("a close name asks \"Did you mean this account?\" with that account, and never answers or reads", async () => {
    const r = await ask(Q("Roth IRAA"));
    expect(r.text).toContain("Did you mean this account?"); expect(r.choices).toEqual(["Roth IRA"]); expect(r.roster).not.toHaveBeenCalled(); expect(r.askVault).not.toHaveBeenCalled();
  });
  it("there is no alias: \"Roth\" does not become Roth IRA", async () => {
    const r = await ask(Q("Roth"));
    expect(r.choices).not.toContain("Roth IRA"); expect(r.roster).not.toHaveBeenCalled(); expect(r.text).not.toMatch(/Illustrative balance/);
  });
  it("one past the bound (3 slips on a long name) is a refusal with no candidate", async () => {
    const r = await ask(Q("Roth IRAAAA"));
    expect(r.choices).not.toContain("Roth IRA"); expect(r.roster).not.toHaveBeenCalled();
  });
  it("two alternatives ask which one account, preserving M5's approved clarification", async () => {
    const r = await ask("extra $50 a month into my Roth IRA or Brokerage until June 2050");
    expect(r.text).toContain("Which one account do you mean?"); expect([...r.choices].sort()).toEqual(["Brokerage", "Roth IRA"]);
  });
});
