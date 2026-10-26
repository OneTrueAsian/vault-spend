// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReplyIndex, observeCase, type RouteEnv } from "../testSupport/askVaultM6/routeHarness";
import { loadAcceptancePackages } from "../testSupport/askVaultM6/combinedAcceptance";
import type { CorpusCase } from "../testSupport/askVaultM6/manifest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// D-R2 on the REAL card (Task5-Remediation-Completion/Decisions-Ledger.md): each of the eight approved store-typo clarifications, on every required seed, first only OFFERS the
// approved candidate and reads nothing; after the approved button is clicked the question is reparsed and the full gold request and the exact frozen result are displayed.
const R = "src/testSupport/askVaultM6/";
const json = (name: string) => JSON.parse(readFileSync(R + name, "utf8"));
const ordinary = loadAcceptancePackages().find(p => p.id === "ordinary")!.input;
const approved: Record<string, string> = ordinary.amendments!.familyResolution!.approvedChoices;
const env: RouteEnv = { contexts: json("contexts.json"), requests: ordinary.requests, references: ordinary.references as RouteEnv["references"] };
const index = buildReplyIndex(env);
const cases: CorpusCase[] = ordinary.cases.filter(c => approved[c.id] !== undefined);

describe("the eight approved store-typo clarifications through the real card", () => {
  it("are exactly eight, all in m1:several-stores", () => {
    expect(cases).toHaveLength(8);
    expect(new Set(cases.map(c => c.family))).toEqual(new Set(["m1:several-stores"]));
  });
  it.each(cases.map(c => [c.id, c] as const))("%s: offers the approved candidate with no read, then answers exactly after the click, on all three seeds", async (_id, c) => {
    for (const r of c.required) {
      const offered = await observeCase(c, r, env, index, { choose: () => null });
      expect(offered.stage, `${r.seed} offered`).toBe("clarify");
      expect(offered.accepted).toEqual([]);
      expect(offered.offeredChoices!.map(l => l.toLowerCase())).toContain(approved[c.id].toLowerCase());
      const clicked = await observeCase(c, r, env, index, { choose: labels => labels.find(l => l.toLowerCase() === approved[c.id].toLowerCase()) ?? null });
      expect(clicked.stage, `${r.seed} clicked`).toBe("result");
      expect(clicked.meaningChoices).toBe(1);
      expect(clicked.readsBeforeChoice).toBe(0);
      expect(clicked.chosen!.toLowerCase()).toBe(approved[c.id].toLowerCase());
      expect(clicked.request).toEqual(env.requests[r.requestId!]);
      expect(clicked.result).toEqual(env.references[r.referenceId!].value);
    }
  });
  it("clicking a different offered candidate would not produce the gold request (the click decides the request)", async () => {
    const c = cases.find(x => x.id === "m1/303-0214")!;   // 'costcco gas': COSTCO GAS is the approved candidate
    const r = c.required[0];
    const offered = await observeCase(c, r, env, index, { choose: () => null });
    const other = offered.offeredChoices!.find(l => l.toLowerCase() !== approved[c.id].toLowerCase());
    if (other === undefined) return;   // only one candidate offered: nothing else to click
    const wrong = await observeCase(c, r, env, index, { choose: labels => labels.find(l => l === other) ?? null });
    expect(wrong.request === undefined || JSON.stringify(wrong.request) !== JSON.stringify(env.requests[r.requestId!])).toBe(true);
  });
});
