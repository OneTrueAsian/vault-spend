import { describe, expect, it, vi } from "vitest";
import { askVault, type AskVaultClient } from "./controller";
import type { AskVaultSnapshot } from "./contract";
import { TransactionError } from "../transactionContracts";
import type { ParseContext } from "./types";

const context: ParseContext = {
  today: "2026-09-06",
  categories: ["Groceries", "Rent"],
  accounts: [{ id: 1, name: "Everyday Checking" }],
  merchants: ["Costco"],
  members: ["Alex"],
};
const snapshot = (over: Partial<AskVaultSnapshot> = {}): AskVaultSnapshot => ({
  contractVersion: 1,
  context: { generation: 1, sessionRevision: 1 },
  revision: { local: 5, external: 2 },
  asOf: "2026-09-06",
  kind: "total",
  spendingBasis: "gross-negative-allocations",
  thresholdBasis: "absolute-parent-amount",
  periods: [{ from: "2026-08-01", to: "2026-08-31", dayCount: 31, endsToday: false, historyCoverage: "unknown", total: "317.13", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [], vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] } }],
  difference: null,
  ...over,
});
const clientReturning = (value: AskVaultSnapshot): AskVaultClient & { askVault: ReturnType<typeof vi.fn> } => ({ askVault: vi.fn(async () => value) });
const clientFailing = (error: unknown): AskVaultClient => ({ askVault: vi.fn(async () => { throw error; }) });

describe("a question the new grammar understands", () => {
  it("reads once and returns a rendered answer with the exact request and the data revision", async () => {
    const client = clientReturning(snapshot());
    const result = await askVault("how much did I spend on groceries last month", context, client);
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault).toHaveBeenCalledWith({
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
    });
    expect(result).toMatchObject({ status: "answer", revision: { local: 5, external: 2 } });
    if (result.status === "answer") expect(result.answer.headline).toBe("You spent $317.13 on Groceries in August 2026.");
  });

  it("passes the question's corrections through so the screen can show them", async () => {
    const result = await askVault("how much i spnt on grocries last month", context, clientReturning(snapshot()));
    expect(result).toMatchObject({ status: "answer", corrections: expect.arrayContaining([{ from: "spnt", to: "spent" }]) });
  });

  it("never sends question text to the native side", async () => {
    const client = clientReturning(snapshot());
    await askVault("groceries last month", context, client);
    expect(JSON.stringify(client.askVault.mock.calls)).not.toMatch(/groceries last month/i);
  });
});

describe("questions that must not reach the native read", () => {
  it.each([
    ["clarify", "groceries"],
    ["unsupported", "groceries last month without"],
    ["legacy", "what's my net worth"],
  ])("%s: %s", async (status, question) => {
    const client = clientReturning(snapshot());
    const result = await askVault(question, context, client);
    expect(result.status).toBe(status);
    expect(client.askVault).not.toHaveBeenCalled();
  });
});

describe("failures are plain and retire the answer", () => {
  it.each(["stale_profile", "profile_locked", "no_profile_open", "superseded"])("%s means the profile moved on", async (code) => {
    const result = await askVault("groceries last month", context, clientFailing(new TransactionError(code, "internal wording")));
    expect(result).toMatchObject({ status: "stale" });
    if (result.status === "stale") expect(result.message).not.toContain("internal wording");
  });

  it("stale data tells the person to ask again", async () => {
    const result = await askVault("groceries last month", context, clientFailing(new TransactionError("stale_data", "Your ledger changed. Ask again using the current data.")));
    expect(result).toMatchObject({ status: "stale", message: "Your ledger changed. Ask again using the current data." });
  });

  it("an invalid_argument keeps the native plain-language message", async () => {
    const result = await askVault("groceries last month", context, clientFailing(new TransactionError("invalid_argument", "Choose valid dates in YYYY-MM-DD format.")));
    expect(result).toEqual({ status: "error", message: "Choose valid dates in YYYY-MM-DD format." });
  });

  it("anything else gets a generic message with no internal text", async () => {
    for (const error of [new TransactionError("internal_error", "sqlite: disk I/O error at /secret/path"), new Error("boom"), "plain string", { weird: true }]) {
      const result = await askVault("groceries last month", context, clientFailing(error));
      expect(result).toEqual({ status: "error", message: "I couldn't answer that right now. Try again in a moment." });
    }
  });

  it("an unreadable reply is reported as such", async () => {
    const result = await askVault("groceries last month", context, clientFailing(new TransactionError("invalid_response", "The app received an incomplete answer. Ask again.")));
    expect(result).toEqual({ status: "error", message: "The app received an incomplete answer. Ask again." });
  });
});

describe("a store question", () => {
  const storeContext: ParseContext = { ...context, merchants: ["SAMS CLUB #6482", "SAMSCLUB.COM", "Costco"], historyStart: "2025-09-01" };
  const period = (over: Record<string, unknown> = {}) => ({
    from: "2025-09-01", to: "2026-09-06", dayCount: 371, endsToday: true, historyCoverage: "unknown" as const, total: "412.90",
    purchaseCount: 6, categoryCount: 2, categories: [], purchases: [],
    vendors: [{ description: "SAMS CLUB #6482", purchaseCount: 5 }, { description: "SAMSCLUB.COM", purchaseCount: 1 }], vendorNameCount: 2,
    vendorTotals: [{ term: "sams club", total: "412.90", purchaseCount: 6 }], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] }, ...over,
  });
  it("sends the store as words, defaults to all records, and shows the names matched", async () => {
    const client = clientReturning(snapshot({ periods: [period()] }));
    const result = await askVault("how much did I spend at Sam's Club?", storeContext, client);
    expect(client.askVault).toHaveBeenCalledWith(expect.objectContaining({ vendors: ["sams club"], periods: [{ from: "2025-09-01", to: "2026-09-06" }] }));
    expect(result).toMatchObject({ status: "answer" });
    if (result.status === "answer") {
      expect(result.answer.headline).toBe("You spent $412.90 at Sam's Club since your records begin.");
      expect(result.answer.matches).toEqual(["SAMS CLUB #6482 (5 purchases)", "SAMSCLUB.COM (1 purchase)"]);
    }
  });
  it("a store that is not on record is never sent to the native read", async () => {
    const client = clientReturning(snapshot());
    expect((await askVault("how much did I spend at zzyzx", storeContext, client)).status).toBe("unsupported");
    expect(client.askVault).not.toHaveBeenCalled();
  });
});
