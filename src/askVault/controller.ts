import type { createFinancialClient } from "../financialReads";
import { transactionError } from "../transactionContracts";
import { CHANGED_BODY } from "./changedState";
import { renderAnswer, type AskVaultAnswer } from "./answer";
import { parseQuestion } from "./parser";
import type { AskClarification, AskDataRevision, AskMemberSelection, AskVaultRequest, AskVaultRequestV2, Correction, Interpretation, ParseContext } from "./types";

export type AskVaultClient = Pick<ReturnType<typeof createFinancialClient>, "askVault">;

export type AskVaultResult =
  | {
      status: "answer";
      answer: AskVaultAnswer;
      interpretation: Interpretation;
      corrections: Correction[];
      request: AskVaultRequest | AskVaultRequestV2;
      /** Purchases behind the first period's total. */
      purchaseCount: number;
      /** Pass back as `expectedRevision` to make a later read fail if the ledger changed in between. */
      revision: AskDataRevision;
    }
  | AskClarification
  | { status: "unsupported"; reason: string }
  /** The older matcher owns this question. */
  | { status: "legacy" }
  /** The profile or the ledger changed while the question was in flight; nothing was shown. */
  | { status: "stale"; message: string }
  | { status: "error"; message: string };

const PROFILE_MOVED = new Set(["stale_profile", "profile_locked", "no_profile_open", "superseded"]);
const GENERIC_MESSAGE = "I couldn't answer that right now. Try again in a moment.";

/** Read the same purchases behind an answer; grouping, averages and alignment do not apply to a purchase ranking. */
export function purchaseDetailsRequest(request: AskVaultRequest | AskVaultRequestV2, revision: AskDataRevision): AskVaultRequest | AskVaultRequestV2 {
  const detail = { ...request, kind: "rank-purchases" as const, periods: [request.periods[0]], limit: 50, expectedRevision: revision };
  return "contractVersion" in request && request.contractVersion === 2
    ? { ...detail, groupBy: "none", average: "none", alignment: "as-requested" }
    : detail;
}

/** Turn any failure into a plain message, and say whether it means "this answer is no longer valid". */
export function explainFailure(failure: unknown): { status: "stale" | "error"; message: string } {
  const error = transactionError(failure);
  if (PROFILE_MOVED.has(error.code)) return { status: "stale", message: CHANGED_BODY };
  if (error.code === "stale_data") return { status: "stale", message: CHANGED_BODY };
  if (error.code === "invalid_argument" || error.code === "invalid_response") return { status: "error", message: error.message };
  return { status: "error", message: GENERIC_MESSAGE };
}

/**
 * Parse a question, read the exact spending it names, and render the answer. Questions the new grammar
 * does not own come back as `legacy` and nothing is read. Failures never expose internal wording.
 */
export async function askVault(question: string, context: ParseContext, client: AskVaultClient, selectedMembers: AskMemberSelection[] = []): Promise<AskVaultResult> {
  const parsed = parseQuestion(question, context, selectedMembers);
  if (parsed.status !== "query") return parsed;
  try {
    const snapshot = "contractVersion" in parsed.request && parsed.request.contractVersion === 2
      ? await client.askVault(parsed.request, { familyMembers: context.familyMembers })
      : await client.askVault(parsed.request);
    return {
      status: "answer",
      answer: renderAnswer(parsed.interpretation, snapshot),
      interpretation: parsed.interpretation,
      corrections: parsed.corrections,
      request: parsed.request,
      purchaseCount: snapshot.periods[0].purchaseCount,
      revision: snapshot.revision,
    };
  } catch (failure) {
    return explainFailure(failure);
  }
}
