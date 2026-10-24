import { describe, expect, it, vi } from "vitest";
import { readRetirementContext, readRetirementRoster, retirementContextClient, retirementSourceFromRoster } from "./retirementContextReader";
import type { ReadRetirementContext, RetirementContextClient, RetirementContextRead, RetirementContextRequest, RetirementSource } from "./retirementScenarioContract";
import type { RetirementContextReply, RetirementRosterReply } from "./retirementNativeContract";
import { retirementContextFromReply } from "./retirementNativeContract";
import { TransactionError } from "../transactionContracts";

/** F1: the reader the app uses is the frozen ReadRetirementContext (Contract.md), not a private variant of it. */
const frozen: ReadRetirementContext = readRetirementContext;
const TODAY = "2026-10-17";
const source = (over: Partial<RetirementSource> = {}): RetirementSource => ({ generation: 3, sessionRevision: 11, revision: { local: 40, external: 7 }, settingsRevision: 40, asOf: TODAY, ...over });
const reply = (over: Partial<RetirementContextReply> = {}): RetirementContextReply => ({
  contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { local: 40, external: 7 }, asOf: TODAY, account: { id: 5, name: "Roth IRA", type: "investment" },
  worth: { amount: "10000", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "200" }, returnAssumption: { kind: "stored-plan", annualPct: "7" },
  inflation: { kind: "stored", pct: "3" }, retirementMonth: "2056-01", ...over,
});
const read = (r: RetirementContextReply): RetirementContextRead => retirementContextFromReply(r);
function fakeClient(handler: (request: RetirementContextRequest) => Promise<RetirementContextRead>) { return { readRetirementContext: vi.fn(handler) } satisfies RetirementContextClient; }

describe("F1 frozen ReadRetirementContext", () => {
  it("refuses a reply for another account even when its revision and session match", async () => {
    const other = read(reply({ account: { id: 8, name: "Brokerage", type: "investment" } }));
    const result = await frozen({ accountId: 5, client: fakeClient(async () => other), currentSource: () => source() });
    expect(result.status).toBe("error"); expect(result).not.toHaveProperty("context");
  });
  it("compares source fields rather than object property order", async () => {
    const value = read(reply()); value.context.source = { asOf: TODAY, settingsRevision: 40, revision: { external: 7, local: 40 }, sessionRevision: 11, generation: 3 };
    expect(await frozen({ accountId: 5, client: fakeClient(async () => value), currentSource: () => source() })).toMatchObject({ status: "context" });
  });
  it("validates the frozen request before calling the client", async () => {
    const client = fakeClient(async () => read(reply()));
    expect(await frozen({ accountId: 0, client, currentSource: () => source() })).toMatchObject({ status: "error" });
    expect(client.readRetirementContext).not.toHaveBeenCalled();
  });
  it.each(["hidden", "symbol", "inherited", "nested-hidden"])("does not repair a malformed %s source by cloning it before validation", async kind => {
    const captured = source();
    if (kind === "hidden") Object.defineProperty(captured, "extra", { value: true });
    if (kind === "symbol") Object.defineProperty(captured, Symbol("extra"), { value: true });
    if (kind === "inherited") Object.setPrototypeOf(captured, { unexpected: true });
    if (kind === "nested-hidden") Object.defineProperty(captured.revision, "extra", { value: true });
    const client = fakeClient(async () => read(reply()));
    expect(await frozen({ accountId: 5, client, currentSource: () => captured })).toMatchObject({ status: "error" });
    expect(client.readRetirementContext).not.toHaveBeenCalled();
  });
  it.each([
    { currentValue: "NaN" },
    { contribution: { kind: "saved", monthlyAmount: "-1" } },
  ])("validates the returned account evidence independently of the client type (%j)", async patch => {
    const value = read(reply()); Object.assign(value.context, patch);
    const result = await frozen({ accountId: 5, client: fakeClient(async () => value), currentSource: () => source() });
    expect(result.status).toBe("error"); expect(result).not.toHaveProperty("context");
  });
  it("rejects malformed inflation and extra reply fields before returning financial context", async () => {
    for (const value of [{ ...read(reply()), inflation: { kind: "stored", pct: "-1" } }, { ...read(reply()), unexpected: "other account evidence" }]) {
      const result = await frozen({ accountId: 5, client: fakeClient(async () => value as RetirementContextRead), currentSource: () => source() });
      expect(result.status).toBe("error"); expect(result).not.toHaveProperty("context");
    }
  });
  it("captures a detached expected source so in-place changes cannot authorize an old read", async () => {
    const live = source(); let finish!: (value: RetirementContextRead) => void;
    const pending = frozen({ accountId: 5, client: fakeClient(() => new Promise(resolve => { finish = resolve; })), currentSource: () => live });
    live.revision.local++; const changed = read(reply({ revision: { local: 41, external: 7 } })); changed.context.source.settingsRevision = live.settingsRevision;
    finish(changed); expect(await pending).toMatchObject({ status: "stale" });
  });
  it("a rejection after a non-null source change is stale, rather than an error for the new source", async () => {
    let live = source(); let fail!: (reason: unknown) => void;
    const pending = frozen({ accountId: 5, client: fakeClient(() => new Promise((_resolve, reject) => { fail = reject; })), currentSource: () => live });
    live = source({ generation: 4 }); fail(new Error("old profile error")); expect(await pending).toMatchObject({ status: "stale" });
  });
  it("returns the context and the inflation candidate for a current source, asking for exactly version, account and expected source", async () => {
    const client = fakeClient(async () => read(reply()));
    const result = await frozen({ accountId: 5, client, currentSource: () => source() });
    expect(result).toEqual({ status: "context", ...read(reply()) });
    expect(client.readRetirementContext).toHaveBeenCalledTimes(1);
    expect(client.readRetirementContext).toHaveBeenCalledWith({ version: 1, accountId: 5, expectedSource: source() });
  });
  it("is stale, without reading, when there is no current source", async () => {
    const client = fakeClient(async () => read(reply()));
    expect(await frozen({ accountId: 5, client, currentSource: () => null })).toMatchObject({ status: "stale" });
    expect(client.readRetirementContext).not.toHaveBeenCalled();
  });
  it("is stale, without reading, when the signal has already aborted", async () => {
    const client = fakeClient(async () => read(reply())); const controller = new AbortController(); controller.abort();
    expect(await frozen({ accountId: 5, client, currentSource: () => source(), signal: controller.signal })).toMatchObject({ status: "stale" });
    expect(client.readRetirementContext).not.toHaveBeenCalled();
  });
  it("is stale, not a late success, when the signal aborts during the read", async () => {
    let finish!: (value: RetirementContextRead) => void; const controller = new AbortController();
    const client = fakeClient(() => new Promise(resolve => { finish = resolve; }));
    const pending = frozen({ accountId: 5, client, currentSource: () => source(), signal: controller.signal });
    controller.abort(); expect(await pending).toMatchObject({ status: "stale" }); finish(read(reply()));
  });
  it("is stale when the source stops being current while the read is in flight", async () => {
    let live: RetirementSource | null = source(); let finish!: (value: RetirementContextRead) => void;
    const client = fakeClient(() => new Promise(resolve => { finish = resolve; }));
    const pending = frozen({ accountId: 5, client, currentSource: () => live });
    live = null; finish(read(reply())); expect(await pending).toMatchObject({ status: "stale" });
  });
  it.each([
    ["another revision", reply({ revision: { local: 41, external: 7 } })],
    ["another session", reply({ context: { generation: 3, sessionRevision: 12 } })],
    ["another profile", reply({ context: { generation: 4, sessionRevision: 11 } })],
  ])("is stale when the reply comes from %s", async (_name, other) => {
    const client = fakeClient(async () => read(other));
    expect(await frozen({ accountId: 5, client, currentSource: () => source() })).toMatchObject({ status: "stale" });
  });
  it.each([
    ["stale_data", "stale"], ["account_unavailable", "stale"], ["stale_profile", "stale"], ["profile_locked", "stale"],
    ["invalid_response", "error"], ["invalid_argument", "error"], ["internal_error", "error"],
  ])("maps a %s failure to %s with a plain message", async (code, status) => {
    const client = fakeClient(async () => { throw new TransactionError(code as never, "internal detail"); });
    const result = await frozen({ accountId: 5, client, currentSource: () => source() });
    expect(result.status).toBe(status);
    // A request or reply the client itself refused carries the client's own plain sentence; every other failure is replaced by one.
    if (code !== "invalid_response" && code !== "invalid_argument") expect((result as { message: string }).message).not.toMatch(/internal detail|stack|not implemented/i);
    else expect((result as { message: string }).message.length).toBeGreaterThan(0);
  });
  it("an unexpected failure is a plain error", async () => {
    const client = fakeClient(async () => { throw new Error("boom"); });
    const result = await frozen({ accountId: 5, client, currentSource: () => source() });
    expect(result).toMatchObject({ status: "error" }); expect((result as { message: string }).message).not.toMatch(/boom|not implemented/);
  });
  it("hands back copies, so a caller cannot change what the client returned", async () => {
    const original = read(reply()); const client = fakeClient(async () => original);
    const result = await frozen({ accountId: 5, client, currentSource: () => source() });
    expect(result.status).toBe("context");
    if (result.status === "context") result.context.currentValue = "1";
    expect(original.context.currentValue).toBe("10000");
  });
});

describe("F1 native client adapter and roster source", () => {
  it("turns the frozen request into the wire request bound to the source's revision, and the wire reply into a context read", async () => {
    const ask = vi.fn(async () => reply());
    const adapted = retirementContextClient({ askVault: vi.fn(), dispose: vi.fn(), askVaultRetirementContext: ask } as never);
    expect(await adapted.readRetirementContext({ version: 1, accountId: 5, expectedSource: source() })).toEqual(read(reply()));
    expect(ask).toHaveBeenCalledWith({ contractVersion: 1, accountId: 5, expectedRevision: { local: 40, external: 7 } });
  });
  it("refuses plainly when the client has no retirement reader", async () => {
    const adapted = retirementContextClient({ askVault: vi.fn(), dispose: vi.fn() } as never);
    await expect(adapted.readRetirementContext({ version: 1, accountId: 5, expectedSource: source() })).rejects.toMatchObject({ code: "invalid_argument" });
  });
  it("a roster reply stands for the source its account reads are bound to", () => {
    const roster: RetirementRosterReply = { contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { local: 40, external: 7 }, asOf: TODAY, accounts: [{ id: 5, name: "Roth IRA" }] };
    expect(retirementSourceFromRoster(roster)).toEqual(source());
  });
});

describe("readRetirementRoster", () => {
  const roster: RetirementRosterReply = { contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { local: 40, external: 7 }, asOf: TODAY, accounts: [{ id: 5, name: "Roth IRA" }] };
  const clientFor = (handler: () => Promise<RetirementRosterReply>) => ({ askVault: vi.fn(), dispose: vi.fn(), askVaultRetirementAccounts: vi.fn(handler) }) as never;
  it("returns the reply while the read is still current", async () => {
    expect(await readRetirementRoster({ client: clientFor(async () => roster), expectedRevision: null, signal: new AbortController().signal, isCurrent: () => true })).toEqual({ status: "read", value: roster });
  });
  it("calls a reply stale, never a success, when the caller stopped being current while it was read", async () => {
    const result = await readRetirementRoster({ client: clientFor(async () => roster), expectedRevision: null, signal: new AbortController().signal, isCurrent: () => false });
    expect(result.status).toBe("stale");
  });
  it("calls a failure stale, not an error, when the caller stopped being current", async () => {
    const result = await readRetirementRoster({ client: clientFor(async () => { throw new TransactionError("stale_profile", "gone"); }), expectedRevision: null, signal: new AbortController().signal, isCurrent: () => false });
    expect(result.status).toBe("stale");
  });
  it("is cancelled when the signal aborts, and reads nothing when it was already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    const client = clientFor(async () => roster);
    expect(await readRetirementRoster({ client, expectedRevision: null, signal: controller.signal, isCurrent: () => true })).toEqual({ status: "cancelled" });
    expect((client as { askVaultRetirementAccounts: ReturnType<typeof vi.fn> }).askVaultRetirementAccounts).not.toHaveBeenCalled();
  });
  it("binds the read to the revision already seen", async () => {
    const client = clientFor(async () => roster);
    await readRetirementRoster({ client, expectedRevision: { local: 40, external: 7 }, signal: new AbortController().signal, isCurrent: () => true });
    expect((client as { askVaultRetirementAccounts: ReturnType<typeof vi.fn> }).askVaultRetirementAccounts).toHaveBeenCalledWith({ contractVersion: 1, expectedRevision: { local: 40, external: 7 } });
  });
});
