import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createFinancialClient } from "../financialReads";
import { retirementNativeFixtures } from "./retirementNativeFixtures";
import type { RetirementContextReply } from "./retirementNativeContract";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const request = { contractVersion: 1 as const, accountId: 5, expectedRevision: null };
const rosterRequest = { contractVersion: 1 as const, expectedRevision: null };
const context = { contractVersion: 1, generation: 3, sessionRevision: 11 };
const reply = () => structuredClone((retirementNativeFixtures().find(f => f.id === "full-saved-plan-holdings")!.expected as { reply: RetirementContextReply }).reply);
const roster = () => ({ contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { local: 40, external: 7 }, asOf: "2026-10-17", accounts: [{ id: 5, name: "Roth IRA" }] });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 17, 12)); vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : c === "get_ask_vault_retirement_accounts" ? roster() : reply()); });
afterEach(() => vi.useRealTimers());
describe("M5 N1–N4 native financial client", () => {
  it("sends only the typed selection and captured origin; validates a minimal roster and exact context", async () => {
    const client = createFinancialClient();
    expect(await client.askVaultRetirementAccounts(rosterRequest)).toEqual(roster());
    expect(await client.askVaultRetirementContext(request)).toEqual(reply());
    expect(invoke).toHaveBeenCalledWith("get_ask_vault_retirement_context", { request, expectedGeneration: 3, expectedSessionRevision: 11 });
  });
  it.each(["context", "roster"])("rejects malformed %s requests before dispatch", async which => {
    const client = createFinancialClient(), bad = { ...(which === "context" ? request : rosterRequest), question: "private" };
    await expect(which === "context" ? client.askVaultRetirementContext({ ...request, ...bad }) : client.askVaultRetirementAccounts(bad)).rejects.toMatchObject({ code: "invalid_argument" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["context", "roster"])("rejects %s from another session", async which => {
    const raw = which === "context" ? reply() : roster(); raw.context.sessionRevision++;
    vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : raw);
    const client = createFinancialClient(); await expect(which === "context" ? client.askVaultRetirementContext(request) : client.askVaultRetirementAccounts(rosterRequest)).rejects.toMatchObject({ code: "stale_profile" });
  });
  it.each(["context", "roster"])("rejects %s crossing midnight even if the reply matches the captured date", async which => {
    vi.mocked(invoke).mockImplementation(async c => { if (c === "get_transaction_context") return context; vi.setSystemTime(new Date(2026, 9, 18, 0)); return which === "context" ? reply() : roster(); });
    const client = createFinancialClient(); await expect(which === "context" ? client.askVaultRetirementContext(request) : client.askVaultRetirementAccounts(rosterRequest)).rejects.toMatchObject({ code: "invalid_response" });
  });
  it.each(["context", "roster"])("disposal invalidates a dispatched %s reply", async which => {
    let complete!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : new Promise(resolve => { complete = resolve; }));
    const client = createFinancialClient(), pending = which === "context" ? client.askVaultRetirementContext(request) : client.askVaultRetirementAccounts(rosterRequest);
    const refused = expect(pending).rejects.toMatchObject({ code: "stale_profile" });
    await vi.waitFor(() => expect(complete).toBeDefined()); client.dispose(); complete(which === "context" ? reply() : roster()); await refused;
  });
  it("captures the request before awaiting IPC and returns an isolated reply", async () => {
    let complete!: (v: unknown) => void; vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : new Promise(resolve => { complete = resolve; }));
    const req = { ...request }, pending = createFinancialClient().askVaultRetirementContext(req);
    await vi.waitFor(() => expect(complete).toBeDefined()); req.accountId = 999; const raw = reply(); complete(raw); const got = await pending;
    raw.account.name = "changed"; expect(got.account.id).toBe(5); expect(got.account.name).toBe("Roth IRA");
  });
  it("rejects the wrong account without retry or legacy fallback", async () => {
    const raw = reply(); raw.account.id = 99; vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : raw);
    await expect(createFinancialClient().askVaultRetirementContext(request)).rejects.toMatchObject({ code: "invalid_response" });
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c !== "get_transaction_context")).toHaveLength(1);
  });
});
