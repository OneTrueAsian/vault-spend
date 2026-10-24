import { anyVendorMatches } from "./vendor";
import { parseQuestion } from "./parser";
import type { AskAccount, AskFamilyMember, ParseContext, ParseOutcome } from "./types";

/**
 * Wording shared by the three readers that can see a question that begins with "save" (savings target, extra money into an
 * investment account, spending reduction). One definition, so the readers cannot drift apart about what such a question starts with.
 */

const normalize = (text: string) => text.normalize("NFC").toLocaleLowerCase("en-US").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A plain save lead-in: "Save", "Please save", "Help me save", "Can you help me save", "I/We want to save", "How/Where can/could I/we save".
 * The savings-target reader's "cut back to save" lead-ins are deliberately not here: they name spending cuts, not a plain saving.
 */
export const SAVING_LEAD = /^\s*(?:please\s+)?(?:(?:how|where)\s+(?:can|could)\s+(?:i|we)\s+save|(?:can\s+you\s+)?help\s+(?:me|us)\s+save|(?:i|we)\s+want\s+to\s+save|save)\b/iu;

/** A pattern for a whole name inside free text: not part of a longer word, any run of spaces in the name matches any run of spaces. */
export function wholeNamePattern(name: string, flags = "iu"): RegExp | null {
  const trimmed = name.normalize("NFC").trim();
  if (!trimmed) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(trimmed).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, flags);
}

/** True when the text contains the name as a whole name, ignoring case, accents written as combining marks and runs of spaces. */
export function namesWholeName(text: string, name: string): boolean {
  const pattern = wholeNamePattern(normalize(name));
  return pattern !== null && pattern.test(normalize(text));
}

/** True when the question names one of the Dashboard's investment accounts. Never authorization; the native roster is read before any review. */
export function namesInvestmentAccount(text: string, context: Pick<ParseContext, "investmentAccounts"> | null | undefined): boolean {
  const accounts = context?.investmentAccounts;
  return Array.isArray(accounts) && accounts.some(account => typeof account?.name === "string" && namesWholeName(text, account.name));
}

/** Words that make a reader treat a question as a savings, cut or extra-money instruction. A store called "Cut Above" or "Save A Lot" holds them without meaning them. */
const OPERATOR_WORD = /(?<![\p{L}\p{N}])(?:what\s+if|if\s+(?:i|we)|one[ -]time|save|saves|saved|saving|savings|cut|cuts|cutting|reduce|reduced|reducing|less|extra|additional|add|put|deposit|contribute|invest|investing)(?![\p{L}\p{N}])/iu;
type StoreContext = { today?: string; categories?: readonly string[]; accounts?: readonly AskAccount[]; merchants?: readonly string[];
  members?: readonly string[]; familyMembers?: readonly AskFamilyMember[]; historyStart?: string };
type Query = Extract<ParseOutcome, { status: "query" }>;

/**
 * D-S4-02: recognize an ordinary interpretation by consuming the ENTIRE question with
 * the existing ordinary grammar. A dollar threshold is not proof of a cut instruction,
 * and a roster entry named CUT is not permission to erase a verb. No reads occur here.
 * A missing-period choice can establish the same store interpretation, but is never
 * selected for the user. The original question still goes to the ordinary reader.
 *
 * Preserve the original merchant-array identity: vendor.ts prepares it once (including
 * duplicate bank descriptions), instead of rebuilding a 50k-entry roster per handler.
 */
export function ordinaryOperatorStore(text: string, context: StoreContext | null | undefined): Query | null {
  const merchants = context?.merchants;
  if (!context?.today || !Array.isArray(merchants) || !merchants.length || text.length > 512 || !OPERATOR_WORD.test(text)) return null;
  // The three readers that call this (savings target, extra money, spending cut) ask about the same question in turn. Reading it is
  // the expensive step (an unknown store name is compared with the whole roster), so it is read once and the answer is shared.
  // The key holds every input the ordinary reader uses, so a new day, edited lists or a different question is read again.
  const key = JSON.stringify([text, context.today, context.categories, context.accounts, context.members, context.familyMembers, context.historyStart]);
  const known = readOnce.get(merchants);
  if (known?.key === key) return known.query;
  const query = readOrdinary(text, context as StoreContext & { today: string }, merchants);
  readOnce.set(merchants, { key, query });
  return query;
}

/** The latest question read against each roster. The roster list is the cache key because it is the large input and is never edited in place. */
const readOnce = new WeakMap<readonly string[], { key: string; query: Query | null }>();

function readOrdinary(text: string, context: StoreContext & { today: string }, merchants: readonly string[]): Query | null {
  const ctx: ParseContext = { today: context.today, categories: [...(context.categories ?? [])], accounts: [...(context.accounts ?? [])],
    // The ordinary parser only reads this list. Retain its identity for the vendor cache.
    merchants: merchants as string[], members: context.members ? [...context.members] : undefined,
    familyMembers: context.familyMembers ? [...context.familyMembers] : undefined, historyStart: context.historyStart };
  const parsed = parseQuestion(text, ctx);
  let queries: Query[];
  if (parsed.status === "query") queries = [parsed];
  else if (parsed.status === "clarify" && parsed.replacements?.length) {
    const alternatives = parsed.replacements.map(t => parseQuestion(t, ctx));
    if (!alternatives.every((p): p is Query => p.status === "query")) return null;
    // Only a missing date may differ. Never select a fuzzy store/account/category.
    const withoutDates = (p: Query) => JSON.stringify({ ...p.request, periods: [] });
    if (alternatives.some(p => withoutDates(p) !== withoutDates(alternatives[0]))) return null;
    queries = alternatives;
  } else return null;
  const terms = [...queries[0].request.vendors, ...queries[0].request.excludeVendors];
  return terms.length && terms.every(term => anyVendorMatches(merchants, term.replace(/\s/g, ""))) ? queries[0] : null;
}

/** Retirement or investment words, outside quotes: with an extra or additional marker they say the money is meant for an investment account. */
export const RETIREMENT_WORDS = /\b(?:retire|retiring|retirement|401k|ira|brokerage|investments?|employer match)\b/iu;
export const EXTRA_MARKER = /\b(?:extra|additional)\b/iu;
