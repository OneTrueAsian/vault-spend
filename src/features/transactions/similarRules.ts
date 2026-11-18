/** Fixing a transaction's category teaches the app a rule for that merchant.
 * These helpers back the "N similar transactions could use it too" offer
 * shown afterwards — for a single row and for a bulk change alike. */

/** The distinct merchants (transaction descriptions) among `descriptions`,
 * trimmed and in first-seen order. Matching is case-insensitive — the rule
 * engine is too — keeping the first spelling. Blanks are dropped. */
export function distinctMerchants(descriptions: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of descriptions) {
    const name = raw?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** The notice's wording: one merchant is named outright; several are
 * summarized by count so the line stays short. `count` is how many other
 * transactions the new rule(s) would re-categorize. */
export function similarOfferText(merchants: string[], category: string, count: number): string {
  const others = `${count} similar transaction${count === 1 ? "" : "s"}`;
  if (merchants.length === 1) {
    return `Saved a rule: "${merchants[0]}" → ${category}. ${others} could use it too.`;
  }
  return `Saved rules for ${merchants.length} merchants → ${category}. ${others} could use them too.`;
}
