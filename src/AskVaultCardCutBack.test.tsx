// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard } from "./AskVaultCard";
import type { ParseContext } from "./askVault/common/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The real card answering "Where can I save money?" from fake report and budget reads. */
const TODAY = "2026-11-19";
const ctx: ParseContext = { today: TODAY, categories: ["Dining", "Groceries", "Rent"], accounts: [{ id: 1, name: "Everyday Checking" }], merchants: [], members: [] };
const REVISION = { local: 4, external: 1 };
const envelope = { contractVersion: 1 as const, context: { generation: 1, sessionRevision: 1 }, revision: { ...REVISION } };
const month = (m: string, category: string, amount: string) => ({ month: m, category, amount });
const reportReply = {
  ...envelope, fromYear: 2026, fromMonth: 7, toYear: 2026, toMonth: 10, daily: [], flow: {} as never,
  cells: [
    month("2026-07", "Dining", "200"), month("2026-08", "Dining", "200"), month("2026-09", "Dining", "200"), month("2026-10", "Dining", "400"),
    month("2026-07", "Rent", "1500"), month("2026-08", "Rent", "1500"), month("2026-09", "Rent", "1500"), month("2026-10", "Rent", "1500"),
  ],
};
const budgetReply = {
  ...envelope, year: 2026, month: 11, alerts: [], flow: {} as never, members: [], budgetTotals: { income: "0", expense: "0" },
  actuals: [
    { category: "Dining", budget_group: "flexible", budgeted: "250", actual: "300", cap_enabled: false, rollover: "0", rollover_enabled: false },
    { category: "Rent", budget_group: "fixed", budgeted: "1500", actual: "1500", cap_enabled: false, rollover: "0", rollover_enabled: false },
  ],
};
const makeClient = () => ({
  askVault: vi.fn(async () => { throw new Error("not this route"); }),
  report: vi.fn(async () => reportReply),
  budget: vi.fn(async () => budgetReply),
  dispose: vi.fn(),
});

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function mount(client: ReturnType<typeof makeClient>, dataKey: unknown = "v1") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (key: unknown) => act(() => root!.render(
    <AskVaultCard getContext={() => ctx} legacyAsk={() => ({ matched: false, answer: "" })} dataKey={key} reloadKey={key} accountNames={new Map()} createClient={() => client as never} />,
  ));
  render(dataKey);
  return render;
}
const input = () => document.querySelector<HTMLInputElement>('input[aria-label="Your question"]')!;
async function ask(text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { document.querySelector<HTMLFormElement>("form")!.requestSubmit(); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

describe("Ask the Vault: where can I save money?", () => {
  it("reads the four full months before this one and this month's budget, then lists the facts", async () => {
    const client = makeClient();
    mount(client);
    await ask("Where can I save money in my budget?");
    expect(client.report).toHaveBeenCalledWith(2026, 7, 2026, 10);
    expect(client.budget).toHaveBeenCalledWith(2026, 11);
    expect(client.askVault).not.toHaveBeenCalled();
    const answer = document.querySelector("[data-cut-back]")!;
    expect(answer.textContent).toContain("Places you could look, from your own records");
    expect([...answer.querySelectorAll("[data-cut-back-section] h3")].map(h => h.textContent)).toEqual(["Over budget this month", "Higher than usual in October", "Your biggest flexible spending"]);
    expect(answer.querySelector('[data-cut-back-section="over-budget"]')!.textContent).toContain("$50.00 over its $250.00 budget so far");
    expect(answer.textContent).not.toContain("Rent");
  });

  it("fills the question box with a what-if the person can change before asking", async () => {
    const client = makeClient();
    mount(client);
    await ask("What can I cut back on?");
    const tryButton = document.querySelector<HTMLButtonElement>('[data-cut-back-section="biggest"] button')!;
    expect(tryButton.textContent).toBe("Try a what-if");
    await act(async () => tryButton.click());
    expect(input().value).toBe("What if I cut Dining by $25 a month?");
    expect(document.activeElement).toBe(input());
  });

  it("retires the answer when the data changes", async () => {
    const client = makeClient();
    const render = mount(client);
    await ask("Where am I overspending?");
    expect(document.querySelector("[data-cut-back]")).not.toBeNull();
    render("v2");
    expect(document.querySelector("[data-cut-back]")).toBeNull();
    expect(document.body.textContent).toContain("Your details changed");
  });

  it("says it couldn't read rather than showing nothing", async () => {
    const client = makeClient();
    client.report.mockRejectedValueOnce(new Error("boom"));
    mount(client);
    await ask("How can I save money?");
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("couldn't read your spending");
  });

  it("answers the everyday wording a person tried first", async () => {
    const client = makeClient();
    mount(client);
    await ask("where can i cut back on my spending?");
    expect(document.querySelector("[data-cut-back]")!.textContent).toContain("Places you could look");
  });

  it.each([
    ["a spending what-if", "Help me save $50 on Dining at Costco each month"],
    ["a savings target", "Where can I cut back to save $200 a month from my budget"],
  ])("suggests questions it can answer when it can't do %s, and asks the one chosen", async (_, question) => {
    const client = makeClient();
    mount(client);
    await ask(question);
    const tries = document.querySelector("[data-try-instead]")!;
    expect(tries.textContent).toContain("Try one of these instead");
    const buttons = [...tries.querySelectorAll("button")];
    expect(buttons.map(b => b.textContent)).toEqual(["Where can I save money in my budget?", "What can I cut back on?", "What if I cut Groceries by $50 a month?"]);
    await act(async () => buttons[0].click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(document.querySelector("[data-try-instead]")).toBeNull();
    expect(input().value).toBe("Where can I save money in my budget?");
    expect(document.querySelector("[data-cut-back]")!.textContent).toContain("Places you could look");
  });

  it("leaves a question with an amount to the savings-target preview", async () => {
    const client = makeClient();
    mount(client);
    await ask("Where can I cut back to save $200 a month?");
    expect(client.report).not.toHaveBeenCalled();
    expect(document.querySelector("[data-cut-back]")).toBeNull();
  });
});
