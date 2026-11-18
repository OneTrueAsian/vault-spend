import { describe, expect, it } from "vitest";
import { flipConfirmText, importSignSuggestion } from "./importSigns";

const credit = (import_flip_signs: boolean | null) => ({ account_type: "credit", import_flip_signs });
const checking = (import_flip_signs: boolean | null) => ({ account_type: "checking", import_flip_signs });

describe("importSignSuggestion", () => {
  it("offers the answer the last import into this account used", () => {
    expect(importSignSuggestion(checking(true), { positive: 1, negative: 9 })).toEqual({ flip: true, reason: "remembered" });
    expect(importSignSuggestion(credit(false), { positive: 9, negative: 1 })).toEqual({ flip: false, reason: "remembered" });
  });

  it("suggests flipping a credit card file whose amounts are mostly positive (charges shown as positive)", () => {
    expect(importSignSuggestion(credit(null), { positive: 48, negative: 8 })).toEqual({ flip: true, reason: "credit-positive" });
  });

  it("suggests nothing for a credit card file that already uses negative charges", () => {
    expect(importSignSuggestion(credit(null), { positive: 27, negative: 463 })).toEqual({ flip: null, reason: null });
  });

  it("suggests nothing for a non-credit account, whatever the file looks like", () => {
    expect(importSignSuggestion(checking(null), { positive: 40, negative: 2 })).toEqual({ flip: null, reason: null });
  });

  it("suggests nothing when the file could not be read ahead or the account is unknown", () => {
    expect(importSignSuggestion(credit(null), null)).toEqual({ flip: null, reason: null });
    expect(importSignSuggestion(undefined, { positive: 9, negative: 1 })).toEqual({ flip: null, reason: null });
  });

  it("does not treat an even split as mostly positive", () => {
    expect(importSignSuggestion(credit(null), { positive: 5, negative: 5 })).toEqual({ flip: null, reason: null });
  });
});

describe("flipConfirmText", () => {
  it("names how many rows and which account", () => {
    expect(flipConfirmText(56, ["Amex Blue"])).toBe("Flip the sign of 56 transactions in Amex Blue?");
  });

  it("uses the singular for one row and lists several accounts", () => {
    expect(flipConfirmText(1, ["Amex Blue"])).toBe("Flip the sign of 1 transaction in Amex Blue?");
    expect(flipConfirmText(3, ["Amex Blue", "Capitol One"])).toBe("Flip the sign of 3 transactions in Amex Blue and Capitol One?");
    expect(flipConfirmText(4, ["A", "B", "C"])).toBe("Flip the sign of 4 transactions in A, B and C?");
  });
});
