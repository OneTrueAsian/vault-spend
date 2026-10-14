import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createFinancialClient } from "../financialReads";
import type { AskVaultRequest } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const context = { contractVersion: 1, generation: 3, sessionRevision: 7 };
const request: AskVaultRequest = {
  kind: "total",
  periods: [{ from: "2026-08-01", to: "2026-08-31" }],
  accountIds: [],
  categories: ["Groceries"],
  minimumPurchase: null,
  vendors: [],
  excludeVendors: [],
  excludeCategories: [],
  limit: 1,
  expectedRevision: null,
};
const reply = (over: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  context,
  revision: { local: 5, external: 2 },
  asOf: "2026-09-06",
  kind: "total",
  spendingBasis: "gross-negative-allocations",
  thresholdBasis: "absolute-parent-amount",
  periods: [
    { from: "2026-08-01", to: "2026-08-31", dayCount: 31, endsToday: false, historyCoverage: "unknown", total: "317.13", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [], vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] } },
  ],
  difference: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 6, 12, 0, 0));
  vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply()));
});
afterEach(() => vi.useRealTimers());

describe("the Ask the Vault read", () => {
  it("sends only the typed request plus the captured profile origin, and returns the exact total", async () => {
    const result = await createFinancialClient().askVault(request);
    expect(result.periods[0].total).toBe("317.13");
    expect(invoke).toHaveBeenCalledWith("get_ask_vault_snapshot", { request, expectedGeneration: 3, expectedSessionRevision: 7 });
  });

  it("refuses a reply that belongs to another profile session", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply({ context: { ...context, sessionRevision: 8 } })));
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "stale_profile" });
  });

  it("refuses a reply computed for another day", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply({ asOf: "2026-09-05" })));
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("refuses a reply that does not echo the question", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply({ kind: "compare" })));
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("keeps a structured refusal and does not retry it", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => {
      if (c === "get_transaction_context") return context;
      throw { code: "stale_data", message: "Your ledger changed. Ask again using the current data." };
    });
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "stale_data" });
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "get_ask_vault_snapshot")).toHaveLength(1);
  });

  it("a disposed client never dispatches", async () => {
    const client = createFinancialClient();
    client.dispose();
    await expect(client.askVault(request)).rejects.toMatchObject({ code: "stale_profile" });
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "get_ask_vault_snapshot")).toHaveLength(0);
  });
});
