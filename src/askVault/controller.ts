import type { createFinancialClient } from "../financialReads";
import { transactionError } from "../transactionContracts";
import { renderAnswer, type AskVaultAnswer } from "./answer";
import { parseQuestion } from "./parser";
import type { AskDataRevision, AskVaultRequest, Correction, Interpretation, ParseContext } from "./types";

export type AskVaultClient = Pick<ReturnType<typeof createFinancialClient>, "askVault">;

export type AskVaultResult =
  | {
      status: "answer";
      answer: AskVaultAnswer;
      interpretation: Interpretation;
      corrections: Correction[];
      request: AskVaultRequest;
      /** Purchases behind the first period's total. */
      purchaseCount: number;
      /** Pass back as `expectedRevision` to make a later read fail if the ledger changed in between. */
      revision: AskDataRevision;
    }
  | { status: "clarify"; reason: string; choices: string[]; replacements?: string[] }
  | { status: "unsupported"; reason: string }
  /** The older matcher owns this question. */
  | { status: "legacy" }
  /** The profile or the ledger changed while the question was in flight; nothing was shown. */
  | { status: "stale"; message: string }
  | { status: "error"; message: string };

const PROFILE_MOVED = new Set(["stale_profile", "profile_locked", "no_profile_open", "superseded"]);
const PROFILE_MESSAGE = "That question belongs to a profile that is no longer open. Ask it again.";
const GENERIC_MESSAGE = "I couldn't answer that right now. Try again in a moment.";

/** Turn any failure into a plain message, and say whether it means "this answer is no longer valid". */
export function explainFailure(failure: unknown): { status: "stale" | "error"; message: string } {
  const error = transactionError(failure);
  if (PROFILE_MOVED.has(error.code)) return { status: "stale", message: PROFILE_MESSAGE };
  if (error.code === "stale_data") return { status: "stale", message: "Your ledger changed. Ask again using the current data." };
  if (error.code === "invalid_argument" || error.code === "invalid_response") return { status: "error", message: error.message };
  return { status: "error", message: GENERIC_MESSAGE };
}

/**
 * Parse a question, read the exact spending it names, and render the answer. Questions the new grammar
 * does not own come back as `legacy` and nothing is read. Failures never expose internal wording.
 */
export async function askVault(question: string, context: ParseContext, client: AskVaultClient): Promise<AskVaultResult> {
  const parsed = parseQuestion(question, context);
  if (parsed.status !== "query") return parsed;
  try {
    const snapshot = await client.askVault(parsed.request);
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
