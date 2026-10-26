import { CHANGED_BODY } from "./changedState";
import { createFinancialClient } from "../financialReads";
import { TransactionError } from "../transactionContracts";
import type { AskDataRevision } from "./types";
import { explainRetirementFailure, retirementContextFromReply, retirementSourceFromReply, retirementWireRequestFromSource } from "./retirementNativeContract";
import type { RetirementRosterReply } from "./retirementNativeContract";
import type { ReadRetirementContext, RetirementContextClient, RetirementSource } from "./retirementScenarioContract";
import { validateRetirementContextRequest, validateRetirementContext, validateRetirementInflationCandidate } from "./retirementScenarioContract";

export type RetirementClient = Pick<ReturnType<typeof createFinancialClient>, "askVault" | "dispose"> & Partial<Pick<ReturnType<typeof createFinancialClient>, "askVaultRetirementAccounts" | "askVaultRetirementContext">>;
export type RetirementReadResult<T> = { status: "read"; value: T } | { status: "stale" | "error"; message: string } | { status: "cancelled" };
const CHANGED = CHANGED_BODY;
const MISSING = "The investment accounts can't be read in this version of the app.";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactRead = (value: unknown) => record(value) && Reflect.ownKeys(value).length === 2 &&
  Object.prototype.hasOwnProperty.call(value, "context") && Object.prototype.hasOwnProperty.call(value, "inflation");

/** Resolves as cancelled the moment the signal aborts, so callers' frames are released even while the native read is still running. */
function untilCancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve(null); };
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, failure => { signal.removeEventListener("abort", abort); reject(failure); });
    if (signal.aborted) abort();
  });
}

/** One authorized read of the investment accounts a question may name. `expectedRevision` binds the read to a revision already seen. */
export async function readRetirementRoster(args: { client: RetirementClient; expectedRevision: AskDataRevision | null; signal: AbortSignal; isCurrent: () => boolean }): Promise<RetirementReadResult<RetirementRosterReply>> {
  const { client, signal } = args;
  if (!client.askVaultRetirementAccounts) return { status: "error", message: MISSING };
  if (signal.aborted) return { status: "cancelled" };
  try {
    const value = await untilCancelled(client.askVaultRetirementAccounts({ contractVersion: 1, expectedRevision: args.expectedRevision }), signal);
    if (value === null || signal.aborted) return { status: "cancelled" };
    return args.isCurrent() ? { status: "read", value } : { status: "stale", message: CHANGED };
  } catch (failure) {
    if (signal.aborted) return { status: "cancelled" };
    return args.isCurrent() ? explainRetirementFailure(failure) : { status: "stale", message: CHANGED };
  }
}

/** The source a roster reply stands for. Account reads that follow are bound to its revision, so roster and account come from one snapshot. */
export function retirementSourceFromRoster(reply: RetirementRosterReply): RetirementSource {
  return retirementSourceFromReply({ context: reply.context, revision: reply.revision, asOf: reply.asOf });
}

/** Adapts the native financial client to the frozen `client.readRetirementContext(request)` shape: the request's expected source becomes the wire request's revision. */
export function retirementContextClient(client: RetirementClient): RetirementContextClient {
  return {
    async readRetirementContext(request) {
      if (!client.askVaultRetirementContext) throw new TransactionError("invalid_argument", MISSING);
      return retirementContextFromReply(await client.askVaultRetirementContext(retirementWireRequestFromSource(request.accountId, request.expectedSource)));
    },
  };
}

const same = (a: RetirementSource, b: RetirementSource) => a.generation === b.generation && a.sessionRevision === b.sessionRevision &&
  a.settingsRevision === b.settingsRevision && a.asOf === b.asOf && a.revision?.local === b.revision?.local && a.revision?.external === b.revision?.external;

/**
 * The frozen domain reader (Contract.md): the account's context and the saved-inflation candidate, read bound to `currentSource()`.
 * No current source, an aborted signal, a source that stops being current during the read, or a reply from another source (revision, session,
 * profile or date) is stale and never a late success. Failures become plain stale or error messages; copies are returned.
 */
export const readRetirementContext: ReadRetirementContext = async ({ accountId, client, currentSource, signal }) => {
  const stale = { status: "stale" as const, message: CHANGED };
  const captured = currentSource();
  if (!captured || signal?.aborted) return stale;
  const invalid = { status: "error" as const, message: "The retirement information could not be verified. Read the current details again." };
  let expected: RetirementSource;
  try {
    if (!validateRetirementContextRequest({ version: 1, accountId, expectedSource: captured }).ok) return invalid;
    expected = structuredClone(captured);
  } catch { return invalid; }
  try {
    const request = { version: 1 as const, accountId, expectedSource: structuredClone(expected) };
    if (!validateRetirementContextRequest(request).ok) return invalid;
    const work = client.readRetirementContext(request);
    const value = signal ? await untilCancelled(work, signal) : await work;
    if (value === null || signal?.aborted) return stale;
    const live = currentSource();
    if (!live || !same(live, expected)) return stale;
    if (!exactRead(value) || !validateRetirementContext(value.context).ok ||
      !validateRetirementInflationCandidate(value.inflation).ok || value.context.account.id !== accountId) return invalid;
    if (!same(value.context.source, expected)) return stale;
    return { status: "context", ...structuredClone(value) };
  } catch (failure) {
    const live = currentSource();
    if (signal?.aborted || !live || !same(live, expected)) return stale;
    return explainRetirementFailure(failure);
  }
};
