import { describe, expect, it } from "vitest";
import { distinctMerchants, similarOfferText } from "./similarRules";

describe("distinctMerchants", () => {
  it("trims descriptions and keeps each merchant once, in first-seen order", () => {
    expect(distinctMerchants(["Corner Cart ", "Lunch Truck", "Corner Cart", "  Lunch Truck"])).toEqual(["Corner Cart", "Lunch Truck"]);
  });

  it("treats a different case as the same merchant, keeping the first spelling", () => {
    expect(distinctMerchants(["Corner Cart", "CORNER CART", "corner cart"])).toEqual(["Corner Cart"]);
  });

  it("drops blanks and undefined", () => {
    expect(distinctMerchants(["", "   ", undefined, "Corner Cart"])).toEqual(["Corner Cart"]);
  });
});

describe("similarOfferText", () => {
  it("names the one merchant and pluralizes the count", () => {
    expect(similarOfferText(["Corner Cart"], "Entertainment", 2)).toBe(
      'Saved a rule: "Corner Cart" → Entertainment. 2 similar transactions could use it too.',
    );
  });

  it("uses the singular for exactly one", () => {
    expect(similarOfferText(["Corner Cart"], "Entertainment", 1)).toBe(
      'Saved a rule: "Corner Cart" → Entertainment. 1 similar transaction could use it too.',
    );
  });

  it("summarizes several merchants instead of listing them", () => {
    expect(similarOfferText(["Corner Cart", "Lunch Truck", "Ferrywood Coffee"], "Dining Out", 5)).toBe(
      "Saved rules for 3 merchants → Dining Out. 5 similar transactions could use them too.",
    );
  });
});
