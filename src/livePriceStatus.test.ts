import { describe, expect, it } from "vitest";
import { summarizeLivePriceRefresh } from "./livePriceStatus";

describe("summarizeLivePriceRefresh", () => {
  it("reports success with no dash-suffix when nothing failed", () => {
    const result = summarizeLivePriceRefresh({ updated: ["AAPL", "MSFT"], failed: [] });

    expect(result.kind).toBe("success");
    expect(result.text).toBe("Live prices: updated 2 symbol(s)");
  });

  it("downgrades to info, not error, when only some symbols failed", () => {
    const result = summarizeLivePriceRefresh({
      updated: Array.from({ length: 20 }, (_, i) => `SYM${i}`),
      failed: [{ symbol: "PLIDX", error: "Finnhub's plan doesn't include this symbol" }],
    });

    expect(result.kind).toBe("info");
    expect(result.text).toBe("Live prices: updated 20 symbol(s) — PLIDX: Finnhub's plan doesn't include this symbol");
  });

  it("is error only when nothing at all updated", () => {
    const result = summarizeLivePriceRefresh({
      updated: [],
      failed: [{ symbol: "AAPL", error: "Finnhub rejected the API key: invalid token" }],
    });

    expect(result.kind).toBe("error");
  });

  it("collapses symbols that failed with the exact same message into one line instead of repeating it", () => {
    // The most common real case: an invalid API key fails every symbol
    // identically — this must read as one clear line, not N copies of the
    // same sentence joined by semicolons.
    const result = summarizeLivePriceRefresh({
      updated: [],
      failed: [
        { symbol: "AAPL", error: "Finnhub rejected the API key: invalid token" },
        { symbol: "MSFT", error: "Finnhub rejected the API key: invalid token" },
        { symbol: "GOOG", error: "Finnhub rejected the API key: invalid token" },
      ],
    });

    expect(result.text).toBe("Live prices: updated 0 symbol(s) — AAPL, MSFT, GOOG: Finnhub rejected the API key: invalid token");
  });

  it("truncates a long list of identically-failing symbols instead of naming every one", () => {
    const symbols = ["A", "B", "C", "D", "E"];
    const result = summarizeLivePriceRefresh({
      updated: [],
      failed: symbols.map((symbol) => ({ symbol, error: "network error" })),
    });

    expect(result.text).toBe("Live prices: updated 0 symbol(s) — A, B, C +2 more: network error");
  });

  it("keeps distinct error messages as separate groups", () => {
    const result = summarizeLivePriceRefresh({
      updated: ["AAPL"],
      failed: [
        { symbol: "PLIDX", error: "Finnhub's plan doesn't include this symbol" },
        { symbol: "ZZZZ", error: "no data returned for this symbol" },
      ],
    });

    expect(result.text).toBe(
      "Live prices: updated 1 symbol(s) — PLIDX: Finnhub's plan doesn't include this symbol; ZZZZ: no data returned for this symbol",
    );
  });
});
