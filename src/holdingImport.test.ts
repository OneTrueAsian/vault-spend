import { describe, expect, it } from "vitest";
import { addHoldingValues, formatHoldingAmount, mappingFromDraft, suggestHoldingMapping } from "./holdingImport";

describe("holdings import mapping and totals", () => {
  it("suggests broker aliases and leaves ambiguous or total-value columns unchosen", () => {
    const draft = suggestHoldingMapping([" Ticker ", "Quantity", "Market Value", "Total Cost", "Price", "Price"]);
    expect(draft.symbol).toBe("0");
    expect(draft.shares).toBe("1");
    expect(draft.cost_basis).toBe("3");
    expect(draft.price).toBe("");
    expect(mappingFromDraft(draft)).toBeNull();
  });
  it("requires distinct columns but permits ignored optional fields", () => {
    const draft = suggestHoldingMapping(["Symbol", "Shares", "Price", "Cost Basis"]);
    expect(mappingFromDraft(draft)).toEqual({ symbol: 0, name: null, shares: 1, price: 2, cost_basis: 3, asset_class: null });
    expect(mappingFromDraft({ ...draft, cost_basis: "2" })).toBeNull();
  });
  it("sums fractional values before display rounding and preserves large quantities", () => {
    expect(addHoldingValues(["0.005", "0.005"])).toBe("0.010");
    expect(addHoldingValues(["9007199254740993", "0.125", "-1"])).toBe("9007199254740992.125");
    expect(addHoldingValues([])).toBe("0");
  });
  it("shows every meaningful digit while retaining the app's money style", () => {
    expect(formatHoldingAmount("12.51250")).toBe("$12.5125");
    expect(formatHoldingAmount("9007199254740993.00")).toBe("$9,007,199,254,740,993.00");
    expect(formatHoldingAmount("0.0000000000000000000000000001")).toBe("$0.0000000000000000000000000001");
  });
});
