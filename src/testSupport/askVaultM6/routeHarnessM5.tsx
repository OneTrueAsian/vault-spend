import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { AskVaultCard } from "../../AskVaultCard";
import { CORPUS_CONTEXTS, RETIREMENT_CORPUS } from "../../askVault/retirementCorpus";
import { validateRetirementContextReply, validateRetirementRosterReply } from "../../askVault/retirementNativeContract";
import { retirementChoicePrompts } from "../../askVault/retirementScreenContract";
import type { RetirementDraft } from "../../askVault/retirementScenarioContract";
import type { ParseContext } from "../../askVault/types";
import { M5_TODAY, m5FixtureId, type M5Fixture } from "./m5Scenario";
import type { CorpusCase, Observation, Requirement } from "./manifest";

/**
 * Public-route harness for the M5 extra-money family (task-4 item 6). Test-only; jsdom. It drives the real card with a corpus case's own text under the corpus context's
 * accounts; the native context reply is the seed's fixture reply (the focused native test validated those contexts, Q5). It follows the consent path the review offers
 * (the return stated in the question, otherwise the saved plan), and turns what the screens SHOWED into an Observation:
 *  - request: the facts of the review the person consents to (account, extra, month, which return is used), scraped from the review screen;
 *  - result: the figures of the result screen (months, exact deposits, the two assumptions' balances), scraped;
 *  - refusal: "A few details need attention" after consent, or an unsupported message; clarify: a clarification card's choices, or the fields a choices screen asks.
 * Nothing is read from the case's expected values; a mismatch is the card's or the gold's.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const num = (text: string) => Number(text.replace(/[$,]/g, ""));
const PROMPT_TO_ID = new Map(retirementChoicePrompts({ missing: ["account", "extra-amount", "cadence", "start-date", "retirement-month"] } as RetirementDraft).map(p => [p.prompt, p.choice]));

export function scrapeReview(text: string) {
  const account = /Account(.+?)Account value/.exec(text), extra = /Extra\$([\d,]+(?:\.\d{1,2})?) (each month|once)/.exec(text), month = /Retirement month([A-Za-z]+) (\d{4}) \((?:(\d+) months? from now|this month)\)/.exec(text);
  const asked = /Return in your question(-?[\d.]+)% a year/.exec(text), saved = /Return(-?[\d.]+)% a year \(saved in your plan\)/.exec(text);
  return { accountName: account?.[1] ?? null, extra: extra ? { kind: extra[2] === "once" ? "once" : "monthly", amount: extra[1].replace(/,/g, "") } : null,
    retirementMonth: month ? `${month[2]}-${String(MONTHS.indexOf(month[1]) + 1).padStart(2, "0")}` : null, months: month ? Number(month[3] ?? 0) : null,
    asked: asked?.[1] ?? null, saved: saved?.[1] ?? null, unit: /Future dollars \(not adjusted/.test(text) ? "future-dollars" : null };
}
export function scrapeResult(text: string) {
  const row = (label: string) => new RegExp(`${label}(-?\\$[\\d,]+)(-?\\$[\\d,]+)(-?\\$[\\d,]+|no change)(?: (more|less))?`).exec(text);
  const none = row("No investment growth"), grown = /Using your confirmed plan return \((-?[\d.]+)% a year\)(-?\$[\d,]+)(-?\$[\d,]+)(-?\$[\d,]+|no change)(?: (more|less))?/.exec(text);
  const deposits = /Extra deposits: \$([\d,]+\.\d{2}) in total/.exec(text), unit = /Shown in (future|today's) dollars/.exec(text);
  const f = (a: string, b: string, c: string, dir?: string) => ({ without: num(a), with: num(b), difference: c === "no change" ? 0 : dir === "less" ? -num(c) : num(c) });
  return { unit: unit ? (unit[1] === "future" ? "future-dollars" : "today-dollars") : null, extraDeposits: deposits ? deposits[1].replace(/,/g, "") : null,
    noGrowth: none ? f(none[1], none[2], none[3], none[4]) : null, confirmedReturn: grown ? { annualPct: grown[1], ...f(grown[2], grown[3], grown[4], grown[5]) } : null };
}

export async function observeM5Case(c: CorpusCase, r: Requirement, fixtures: M5Fixture[]): Promise<Observation> {
  const gold = RETIREMENT_CORPUS.find(x => x.id === c.id.slice(3))!, context = CORPUS_CONTEXTS[gold.context];
  const accounts = [...context.investmentAccounts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
  const REVISION = { local: 40, external: 7 };
  const client = {
    askVault: vi.fn(async () => { throw new Error("not read"); }), askVaultBaselines: vi.fn(async () => { throw new Error("not read"); }), dispose: vi.fn(),
    askVaultRetirementAccounts: vi.fn(async (req: never) => validateRetirementRosterReply({ contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: M5_TODAY, accounts } as never, req, M5_TODAY)),
    askVaultRetirementContext: vi.fn(async (req: { accountId: number }) => {
      const fixture = fixtures.find(f => f.id === m5FixtureId(r.seed, req.accountId));
      if (!fixture) throw new Error("no native context for this seed and account");
      return validateRetirementContextReply(fixture.expected.reply as never, req as never, M5_TODAY);
    }),
  };
  const parse: ParseContext = { today: M5_TODAY, categories: [], accounts: [], investmentAccounts: [...context.investmentAccounts], merchants: [], members: [], familyMembers: [], historyStart: "2025-01-01" };
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const base = { caseId: c.id, seed: r.seed, contextId: r.contextId, accepted: [] as Observation["accepted"], reviewed: false, consented: false };
  try {
    act(() => root.render(<AskVaultCard getContext={() => parse} legacyAsk={() => ({ matched: false, answer: "I can't answer that." })} dataKey="m5" reloadKey="m5" accountNames={new Map()} createClient={() => client as never} />));
    const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, gold.text); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle(); await settle();
    const dialog = () => document.querySelector('[role="dialog"]');
    const clarify = container.querySelector(".ledger-qa-clarify");
    if (clarify && !dialog()) { const labels = [...clarify.querySelectorAll("button")].map(b => b.textContent ?? ""); return { ...base, stage: "clarify", meaningChoices: labels.length, offeredChoices: labels }; }
    const d = dialog();
    if (!d) return { ...base, stage: "refusal", meaningChoices: 0 };   // left to the older routes: nothing claimed
    const legends = [...d.querySelectorAll("fieldset.scenario-question legend")].map(l => PROMPT_TO_ID.get(l.textContent ?? "")).filter((x): x is NonNullable<typeof x> => !!x);
    if (legends.length) return { ...base, stage: "clarify", meaningChoices: legends.length, offeredChoices: legends };
    const review = scrapeReview(d.textContent ?? "");
    if (review.accountName === null || review.retirementMonth === null) return { ...base, stage: "refusal", meaningChoices: 0 };   // an unsupported message
    const label = review.asked !== null ? `Use ${review.asked}% a year, as you asked` : "Use my saved plan";
    const button = [...d.querySelectorAll("button")].find(b => b.textContent === label);
    if (!button) return { ...base, stage: "error", meaningChoices: 0, reviewed: true };
    const request = { family: "m5-extra-money", accountName: review.accountName, extra: review.extra, startDate: /starting today/.test(d.textContent ?? "") ? "today" : "later", retirementMonth: review.retirementMonth,
      returnChoice: review.asked !== null ? { source: "question", annualPct: review.asked } : { source: "saved-plan" }, displayUnit: review.unit };
    await act(async () => button.click()); await settle();
    const after = dialog()?.textContent ?? "";
    if (/A few details need attention/.test(after)) return { ...base, stage: "refusal", meaningChoices: 0, reviewed: true, consented: true };
    const shown = scrapeResult(after);
    const result = { months: review.months, extraDeposits: shown.extraDeposits, noGrowth: shown.noGrowth, confirmedReturn: shown.confirmedReturn };
    if (!shown.noGrowth || !shown.confirmedReturn) return { ...base, stage: "error", meaningChoices: 0, reviewed: true, consented: true };
    return { ...base, stage: "result", meaningChoices: 0, reviewed: true, consented: true, request: { ...request, displayUnit: shown.unit }, result, accepted: [{ request: { ...request, displayUnit: shown.unit }, result }] };
  } finally {
    act(() => root.unmount()); container.remove(); document.body.innerHTML = "";
  }
}
