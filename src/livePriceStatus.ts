import type { LivePriceRefreshSummary } from "./types";

const MAX_SYMBOLS_SHOWN_PER_ERROR = 3;

/** Turns a `refresh_live_prices` result into one status-banner message,
 * fixing two problems with naively joining every `failed` entry:
 *
 * - Failures sharing the exact same message (most commonly: every symbol
 *   failing identically because the API key itself was rejected) used to
 *   repeat that identical text once per symbol instead of collapsing into
 *   one line naming all the affected symbols.
 * - Severity now reflects how bad the refresh actually was, not just
 *   whether anything at all failed: "error" only when *nothing* updated (a
 *   real problem worth interrupting the user for — a bad key, a spent
 *   quota, a network outage), "info" when most of the refresh succeeded
 *   and a few symbols simply aren't available (e.g. a provider's free tier
 *   not covering a particular index/mutual fund — expected, not urgent,
 *   and this refresh fires unattended every 2 hours), "success" when
 *   nothing failed at all. A single unsupported symbol in an otherwise
 *   healthy portfolio no longer pops a 20-second alarming error toast.
 *
 * Assumes the backend never hands back a raw HTTP status or JSON body in
 * `error` (see finnhub.rs/twelve_data.rs/stockdata.rs's 403 handling) —
 * this only controls grouping/severity, not sanitizing the text itself. */
export function summarizeLivePriceRefresh(summary: LivePriceRefreshSummary): { text: string; kind: "success" | "error" | "info" } {
  const { updated, failed } = summary;
  let text = `Live prices: updated ${updated.length} symbol(s)`;

  if (failed.length > 0) {
    const symbolsByError = new Map<string, string[]>();
    for (const f of failed) {
      const symbols = symbolsByError.get(f.error);
      if (symbols) symbols.push(f.symbol);
      else symbolsByError.set(f.error, [f.symbol]);
    }
    const parts = Array.from(symbolsByError.entries()).map(([error, symbols]) => {
      const shown = symbols.slice(0, MAX_SYMBOLS_SHOWN_PER_ERROR).join(", ");
      const remaining = symbols.length - MAX_SYMBOLS_SHOWN_PER_ERROR;
      const symbolList = remaining > 0 ? `${shown} +${remaining} more` : shown;
      return `${symbolList}: ${error}`;
    });
    text += ` — ${parts.join("; ")}`;
  }

  const kind = failed.length === 0 ? "success" : updated.length === 0 ? "error" : "info";
  return { text, kind };
}
