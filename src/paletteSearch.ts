/** Search and ranking for the command palette (Ctrl+K): jump to a screen, run
 * an action, or find an account, goal or transaction by typing a few letters.
 * Pure, so the ranking can be tested without rendering anything. */

export type PaletteKind = "tab" | "action" | "account" | "goal" | "transaction";

export type PaletteEntry = {
  id: string;
  kind: PaletteKind;
  label: string;
  /** Small right-aligned context, e.g. a transaction's date and amount. Not searched. */
  hint?: string;
  /** Extra words that should find this entry without appearing on it. */
  keywords?: string;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A scorer for one query, built once and reused per entry — the word-start
 * pattern is compiled a single time rather than for every transaction in the
 * ledger on every keystroke. */
function makeScorer(query: string): (text: string) => number {
  const q = query.trim().toLowerCase();
  const wordStart = new RegExp(`(^|[^a-z0-9])${escapeRegExp(q)}`);
  return (text: string) => {
    const t = text.toLowerCase();
    if (!q) return 1;
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    if (wordStart.test(t)) return 60;
    if (t.includes(q)) return 40;
    let matched = 0;
    for (const ch of t) {
      if (ch === q[matched]) matched += 1;
      if (matched === q.length) return 20;
    }
    return 0;
  };
}

/** How well `query` matches `text`, 0 for no match: exact > prefix > start of a
 * word > anywhere inside > the letters in order but scattered ("cf" finds
 * "Cash Flow"). Case doesn't matter. */
export function scoreMatch(query: string, text: string): number {
  return makeScorer(query)(text);
}

/** On a tie the more navigational entry wins — someone typing "bud" wants the
 * Budget screen before a transaction that happens to say "Budget". */
const KIND_BIAS: Record<PaletteKind, number> = { tab: 3, action: 2, account: 1, goal: 1, transaction: 0 };

export function filterPalette(
  entries: PaletteEntry[],
  query: string,
  { limit = 12, transactionCap = 6 }: { limit?: number; transactionCap?: number } = {},
): PaletteEntry[] {
  const q = query.trim();
  if (!q) return entries.filter((e) => e.kind === "tab" || e.kind === "action").slice(0, limit);

  const score = makeScorer(q);
  const scored: { entry: PaletteEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    // A single letter would match half the ledger.
    if (entry.kind === "transaction" && q.length < 2) return;
    const byLabel = score(entry.label);
    const byKeywords = entry.keywords ? Math.max(0, score(entry.keywords) - 5) : 0;
    const best = Math.max(byLabel, byKeywords);
    if (best > 0) scored.push({ entry, score: best + KIND_BIAS[entry.kind], index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const result: PaletteEntry[] = [];
  let transactions = 0;
  for (const { entry } of scored) {
    if (entry.kind === "transaction") {
      if (transactions >= transactionCap) continue;
      transactions += 1;
    }
    result.push(entry);
    if (result.length >= limit) break;
  }
  return result;
}
