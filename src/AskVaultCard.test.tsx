// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard, MORE_EXAMPLES } from "./AskVaultCard";
import { LEDGER_QA_EXAMPLES } from "./ledgerQa";
import { parseQuestion } from "./askVault/parser";
import type { AskVaultSnapshot } from "./askVault/contract";
import type { AskVaultRequest, ParseContext } from "./askVault/types";
import { TransactionError } from "./transactionContracts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const context: ParseContext = {
  today: "2026-09-06",
  categories: ["Groceries", "Dining", "Dining Out", "Rent"],
  accounts: [{ id: 1, name: "Everyday Checking" }],
  merchants: ["SAMS CLUB #6482", "Costco"],
  members: ["Alex"],
  historyStart: "2025-09-01",
};
const period = (over: Record<string, unknown> = {}) => ({
  from: "2026-08-01", to: "2026-08-31", dayCount: 31, endsToday: false, historyCoverage: "unknown" as const,
  total: "317.13", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [], vendors: [], vendorNameCount: 0,
  vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] }, ...over,
});
const snapshot = (over: Partial<AskVaultSnapshot> = {}): AskVaultSnapshot => ({
  contractVersion: 1, context: { generation: 1, sessionRevision: 1 }, revision: { local: 5, external: 2 }, asOf: "2026-09-06",
  kind: "total", spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount", periods: [period()], difference: null, ...over,
});
const purchases = [
  { transactionId: 1, accountId: 1, date: "2026-08-24", description: "Costco", amount: "132.41", parentAmount: "132.41" },
  { transactionId: 2, accountId: 1, date: "2026-08-13", description: "Trader Joes", amount: "88.07", parentAmount: "88.07" },
  { transactionId: 3, accountId: 1, date: "2026-08-06", description: "Whole Foods Market", amount: "96.65", parentAmount: "96.65" },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

type Handler = (request: AskVaultRequest) => Promise<AskVaultSnapshot>;
type Fake = { askVault: ReturnType<typeof vi.fn<Handler>>; dispose: ReturnType<typeof vi.fn<() => void>> };
function fake(handler: Handler): Fake {
  return { askVault: vi.fn<Handler>(handler), dispose: vi.fn<() => void>() };
}
const legacy = vi.fn((q: string) => (q.includes("net worth") ? { matched: true, answer: "Your net worth is $50,178.37." } : { matched: false, answer: "I couldn't match that." }));

function mount(client: Fake, over: { dataKey?: unknown; ctx?: ParseContext; onOpenTransactions?: (f: { category: string; accountIds: number[]; from: string; to: string }) => void } = {}) {
  const element = (key: unknown, reload: unknown = "r1") => (
    <AskVaultCard getContext={() => over.ctx ?? context} legacyAsk={legacy} dataKey={key} reloadKey={reload} accountNames={new Map([[1, "Everyday Checking"]])} onOpenTransactions={over.onOpenTransactions} createClient={() => client} />
  );
  act(() => root.render(element(over.dataKey ?? "v1")));
  return { rerender: (key: unknown, reload?: unknown) => act(() => root.render(element(key, reload))) };
}

async function ask(question: string) {
  const input = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}
// The card shows "working" first and reads the question on the next turn of the event loop, so tests wait one turn.
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const text = () => container.querySelector(".ledger-qa-card")!.textContent ?? "";
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`no button "${label}" in: ${document.body.textContent}`);
  await act(async () => button.click());
  await settle();
};

describe("the Ask the Vault card", () => {
  it("every example shown under Tips & examples is understood, never refused", () => {
    const ctx: ParseContext = { ...context, categories: [...context.categories, "Dining Out"], merchants: [...(context.merchants ?? []), "WHOLE FOODS MARKET", "COSTCO #1"], historyStart: "2025-01-01" };
    for (const example of [...LEDGER_QA_EXAMPLES, ...MORE_EXAMPLES]) {
      const outcome = parseQuestion(example, ctx);
      expect(["query", "legacy", "clarify"], example).toContain(outcome.status);
      if (outcome.status === "clarify") expect(outcome.choices.length, example).toBeGreaterThan(0);
    }
  });

  it("keeps its title, tips button and Ask button", () => {
    mount(fake(async () => snapshot()));
    expect(text()).toContain("Ask the Vault");
    expect(container.querySelector("button[type='submit']")?.textContent).toBe("Ask");
    expect(container.querySelector(".ledger-qa-card .card-head")).not.toBeNull();
  });

  it("shows that it is working before it starts reading the question (so a big ledger cannot delay the first sign of life)", async () => {
    let sawWorking: boolean | null = null;
    const client = fake(async () => snapshot());
    mount(client, { ctx: undefined });
    // A context built at ask time stands in for the work done before parsing.
    root.render(<AskVaultCard getContext={() => { sawWorking = document.body.textContent?.includes("Looking that up") ?? false; return context; }} legacyAsk={legacy} dataKey="v1" accountNames={new Map()} createClient={() => client} />);
    await ask("how much did I spend on groceries last month");
    expect(sawWorking).toBe(true);
  });

  it("reads once from the native side and shows the answer in plain words", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("how much did I spend on groceries last month");
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ kind: "total", categories: ["Groceries"], periods: [{ from: "2026-08-01", to: "2026-08-31" }] });
    expect(container.querySelector(".ledger-qa-answer")!.textContent).toContain("You spent $317.13 on Groceries in August 2026.");
    expect(text()).toContain("3 purchases");
    expect(text()).not.toContain("-$");
  });

  it("says what it understood and shows a correction it made", async () => {
    mount(fake(async () => snapshot()));
    await ask("how much i spnt on grocries last month");
    expect(text()).toContain("I read");
    expect(text()).toContain("spnt");
    expect(text()).toContain("Groceries");
    expect(container.querySelector("[aria-label='What I understood']")?.textContent).toContain("August 2026");
  });

  it("older questions go to the older matcher and never touch the native read", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("what's my net worth");
    expect(client.askVault).not.toHaveBeenCalled();
    expect(container.querySelector(".ledger-qa-answer")!.textContent).toBe("Your net worth is $50,178.37.");
  });

  it("an unsupported question explains itself, keeps the quiet styling and offers examples", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("who let the dogs out");
    expect(client.askVault).not.toHaveBeenCalled();
    const box = container.querySelector(".ledger-qa-answer")!;
    expect(box.className).toContain("ledger-qa-answer-unmatched");
    expect(box.textContent).toContain("I don't understand");
    expect(box.textContent).toContain("Try something like");
  });

  it("a clarification shows choices; picking one asks the new question", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("total spending on din last month");
    expect(client.askVault).not.toHaveBeenCalled();
    expect(text()).toContain("Which one did you mean?");
    expect(text()).toContain("Nothing has been added up yet");
    await click("Dining Out");
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ categories: ["Dining Out"] });
    expect(container.querySelector<HTMLInputElement>(".ledger-qa-card input")!.value).toBe('total spending on "dining out" last month');
    expect(text()).toContain("You spent $317.13 on Dining Out");
  });

  it("a store answer lists the names it matched and each store's total", async () => {
    const client = fake(async () =>
      snapshot({
        periods: [period({
          total: "412.90", purchaseCount: 6, vendorNameCount: 2,
          vendors: [{ description: "SAMS CLUB #6482", purchaseCount: 5 }, { description: "SAMSCLUB.COM", purchaseCount: 1 }],
          vendorTotals: [{ term: "sams club", total: "412.90", purchaseCount: 6 }],
          from: "2025-09-01", to: "2026-09-06", dayCount: 371, endsToday: true,
        })],
      }),
    );
    mount(client);
    await ask("how much did I spend at sams club");
    expect(text()).toContain("since your records begin");
    expect(text()).toContain("SAMS CLUB #6482 (5 purchases)");
  });

  it("View purchases opens the exact purchases behind the total", async () => {
    const client = fake(async (request) =>
      request.kind === "rank-purchases" ? snapshot({ kind: "rank-purchases", periods: [period({ purchases })] }) : snapshot(),
    );
    mount(client);
    await ask("how much did I spend on groceries last month");
    await click("View 3 purchases");
    const detailCall = client.askVault.mock.calls[1][0] as AskVaultRequest;
    expect(detailCall).toMatchObject({ kind: "rank-purchases", categories: ["Groceries"], limit: 50, expectedRevision: { local: 5, external: 2 } });
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain("Costco");
    expect(dialog.textContent).toContain("$132.41");
    expect(dialog.textContent).toContain("Everyday Checking");
    await click("Close");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("a category answer's purchases can be opened in Transactions with the same category, account and dates", async () => {
    const client = fake(async (request) =>
      request.kind === "rank-purchases" ? snapshot({ kind: "rank-purchases", periods: [period({ purchases })] }) : snapshot(),
    );
    const open = vi.fn();
    mount(client, { onOpenTransactions: open });
    await ask("how much did I spend on groceries last month in everyday checking");
    await click("View 3 purchases");
    await click("Open in Transactions");
    expect(open).toHaveBeenCalledWith({ category: "Groceries", accountIds: [1], from: "2026-08-01", to: "2026-08-31" });
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("offers no Open in Transactions when the Transactions tab could not show exactly the same purchases", async () => {
    const client = fake(async (request) =>
      request.kind === "rank-purchases" ? snapshot({ kind: "rank-purchases", periods: [period({ purchases })] }) : snapshot(),
    );
    const open = vi.fn();
    mount(client, { onOpenTransactions: open });
    await ask("how much did I spend at costco last month");
    await click("View 3 purchases");
    expect(document.querySelector("[role='dialog']")!.textContent).not.toContain("Open in Transactions");
    await click("Close");
    await ask("groceries last month without costco");
    await click("View 3 purchases");
    expect(document.querySelector("[role='dialog']")!.textContent).not.toContain("Open in Transactions");
  });

  it("the details dialog says plainly when the ledger changed in between", async () => {
    const client = fake(async (request) => {
      if (request.kind === "rank-purchases") throw new TransactionError("stale_data", "Your ledger changed. Ask again using the current data.");
      return snapshot();
    });
    mount(client);
    await ask("how much did I spend on groceries last month");
    await click("View 3 purchases");
    expect(document.querySelector("[role='dialog']")!.textContent).toContain("Your ledger changed");
  });

  it("an answer is retired when the ledger changes underneath it, and can be asked again", async () => {
    const client = fake(async () => snapshot());
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("$317.13");
    view.rerender("v2");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Your ledger changed");
    await click("Ask again");
    expect(client.askVault).toHaveBeenCalledTimes(2);
    expect(text()).toContain("$317.13");
  });

  it("an open 'Show all' list does not keep showing amounts while the answer is being re-checked", async () => {
    const names = ["Groceries", "Dining Out", "Rent", "Shopping", "Gifts", "Health", "Travel"];
    const categories = names.map((category, i) => ({ category, amount: String(1000 - i * 10), purchaseCount: 1 }));
    let release: (s: AskVaultSnapshot) => void = () => {};
    let holdChecks = false;
    const full = () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 7 })] });
    const client = fake(() => (holdChecks ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(full())));
    const view = mount(client);
    await ask("top 7 spending categories last month");
    await click("Show all 7");
    expect(document.querySelector("[role='dialog']")!.textContent).toContain("$1,000.00");
    holdChecks = true;
    view.rerender("v1", "r2"); // reloaded: the answer is being checked
    await act(async () => {});
    expect(document.body.textContent).not.toContain("$1,000.00");
    expect(document.querySelector("[role='dialog']")).toBeNull();
    await act(async () => release(full()));
    await act(async () => {});
    expect(text()).toContain("$1,000.00"); // confirmed current: the answer is back on the card
  });

  it("a long ranking shows five rows inline and the rest in a dialog", async () => {
    const names = ["Groceries", "Dining Out", "Rent", "Shopping", "Gifts", "Health", "Travel", "Pets", "Fuel", "Coffee"];
    const categories = names.map((category, i) => ({ category, amount: String(1000 - i * 10), purchaseCount: i + 1 }));
    const client = fake(async () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 12, total: "9550", purchaseCount: 55 })] }));
    mount(client);
    await ask("top 10 spending categories last month");
    expect(container.querySelectorAll(".ledger-qa-rows li")).toHaveLength(5);
    expect(text()).not.toContain("Coffee");
    await click("Show all 10");
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.querySelectorAll("li")).toHaveLength(10);
    expect(dialog.textContent).toContain("Coffee");
    await click("Close");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("five or fewer rows have no extra button", async () => {
    const categories = ["Groceries", "Rent"].map((category, i) => ({ category, amount: String(100 - i), purchaseCount: 1 }));
    mount(fake(async () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 2 })] })));
    await ask("top 5 spending categories last month");
    expect(text()).not.toContain("Show all");
  });

  it("no more than three choices are shown at once; the rest sit behind 'More choices'", async () => {
    const many: ParseContext = { ...context, categories: ["Dining", "Dining Out", "Dinner Club", "Diner Tabs", "Dinero"] };
    mount(fake(async () => snapshot()), { ctx: many });
    await ask("total spending on din last month");
    const inline = container.querySelectorAll("[role='group'] > button");
    expect(inline.length).toBeLessThanOrEqual(3);
    expect(inline.length).toBeGreaterThan(0);
    expect(text()).toContain("More choices");
    const more = container.querySelectorAll("[role='group'] details button");
    expect(inline.length + more.length).toBeGreaterThan(3);
  });

  it("a reload with the ledger unchanged keeps the answer; a changed split (same fingerprint) retires it", async () => {
    let revision = { local: 5, external: 2 };
    const client = fake(async () => snapshot({ revision }));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("$317.13");
    view.rerender("v1", "r2"); // the list was reloaded, nothing was written
    await act(async () => {});
    expect(text()).toContain("$317.13");
    revision = { local: 6, external: 2 }; // split amounts changed: same count, same fingerprint
    view.rerender("v1", "r3");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Your ledger changed");
  });

  it("an answer read before the ledger changed is not left standing as current", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let calls = 0;
    const client = fake(() => {
      calls++;
      if (calls === 1) return new Promise<AskVaultSnapshot>((r) => (release = r)); // the question itself, still being read
      return Promise.resolve(snapshot({ revision: { local: 6, external: 2 } })); // the freshness check, after the change
    });
    const view = mount(client);
    await ask("how much did I spend on groceries last month"); // returns while the read is still pending
    view.rerender("v2", "r2"); // the ledger changes while the answer is on its way
    await act(async () => {});
    await act(async () => release(snapshot({ revision: { local: 5, external: 2 } })));
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Your ledger changed");
  });

  it("a purchases list still loading does not open after its answer was retired", async () => {
    let releaseDetails: (s: AskVaultSnapshot) => void = () => {};
    let revision = { local: 5, external: 2 };
    const client = fake((request) => {
      if (request.kind === "rank-purchases") return new Promise<AskVaultSnapshot>((r) => (releaseDetails = r));
      return Promise.resolve(snapshot({ revision }));
    });
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    await click("View 3 purchases"); // the list is being read
    revision = { local: 6, external: 2 };
    view.rerender("v1", "r2"); // the answer is retired
    await act(async () => {});
    expect(text()).toContain("Your ledger changed");
    await act(async () => releaseDetails(snapshot({ kind: "rank-purchases", periods: [period({ purchases })] })));
    await act(async () => {});
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("a 'Show all' list does not come back for the next answer", async () => {
    const names = ["Groceries", "Dining Out", "Rent", "Shopping", "Gifts", "Health", "Travel"];
    const categories = names.map((category, i) => ({ category, amount: String(1000 - i * 10), purchaseCount: 1 }));
    const client = fake(async () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 7 })] }));
    const view = mount(client);
    await ask("top 7 spending categories last month");
    await click("Show all 7");
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    view.rerender("v2"); // answer retired: the dialog goes with it
    await act(async () => {});
    expect(document.querySelector("[role='dialog']")).toBeNull();
    await click("Ask again");
    expect(text()).toContain("Show all 7");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("while an answer is being checked after a reload, its amount is not shown", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let holdChecks = false;
    const client = fake(() => (holdChecks ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(snapshot())));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("$317.13");
    holdChecks = true;
    view.rerender("v1", "r2");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Checking that this is still up to date");
    await act(async () => release(snapshot())); // unchanged: the same answer comes back
    await act(async () => {});
    expect(text()).toContain("$317.13");
    expect(text()).not.toContain("Checking that this");
  });

  it("an answer that turns out to be out of date is never shown, not even briefly", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let holdChecks = false;
    const client = fake(() => (holdChecks ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(snapshot())));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    holdChecks = true;
    const seen: string[] = [];
    view.rerender("v1", "r2");
    seen.push(text());
    await act(async () => release(snapshot({ revision: { local: 9, external: 2 } })));
    seen.push(text());
    await act(async () => {});
    seen.push(text());
    expect(seen.some((s) => s.includes("$317.13"))).toBe(false);
    expect(text()).toContain("Your ledger changed");
  });

  it("if the freshness check itself fails, the answer is retired rather than trusted", async () => {
    let fail = false;
    const client = fake(async () => {
      if (fail) throw new TransactionError("internal_error", "boom");
      return snapshot();
    });
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    fail = true;
    view.rerender("v1", "r2");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
  });

  it("a freshness check that finishes after a newer question was asked is ignored", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let held = false;
    const client = fake(() => (held ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(snapshot())));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    held = true;
    view.rerender("v1", "r2"); // check starts and waits
    held = false;
    await ask("how much did I spend on groceries last month"); // a newer question answers
    release(snapshot({ revision: { local: 99, external: 2 } })); // the old check finishes late with a different revision
    await act(async () => {});
    expect(text()).toContain("$317.13");
    expect(text()).not.toContain("Your ledger changed");
  });

  it("a failed read is reported in plain words with a way to retry", async () => {
    let fail = true;
    const client = fake(async () => {
      if (fail) throw new TransactionError("internal_error", "sqlite: disk I/O error at /secret/path");
      return snapshot();
    });
    mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("I couldn't answer that right now");
    expect(text()).not.toContain("secret");
    fail = false;
    await click("Try again");
    expect(text()).toContain("$317.13");
  });

  it("a profile that closes mid-question shows nothing and releases the client", async () => {
    let finish!: (value: AskVaultSnapshot) => void;
    const client = fake(() => new Promise<AskVaultSnapshot>((resolve) => { finish = resolve; }));
    mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("Looking that up");
    act(() => root.unmount());
    expect(client.dispose).toHaveBeenCalled();
    await act(async () => finish(snapshot()));
    root = createRoot(container);
  });

  it("only the latest question can answer", async () => {
    const pending: Array<(value: AskVaultSnapshot) => void> = [];
    const client = fake(() => new Promise<AskVaultSnapshot>((resolve) => pending.push(resolve)));
    mount(client);
    await ask("how much did I spend on groceries last month");
    await ask("how much did I spend on rent last month");
    await act(async () => pending[1](snapshot({ periods: [period({ total: "1504" })] })));
    await act(async () => pending[0](snapshot({ periods: [period({ total: "1" })] })));
    expect(text()).toContain("$1,504.00");
    expect(text()).not.toContain("$1.00");
  });

  it("announces results to screen readers and labels the choices", async () => {
    mount(fake(async () => snapshot()));
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    await ask("total spending on din last month");
    expect(container.querySelector("[role='group'][aria-label]")).not.toBeNull();
  });
});
