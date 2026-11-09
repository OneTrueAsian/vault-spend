import { describe, expect, it } from "vitest";
import { Tag } from "lucide-react";
import { iconForCategory, isCategoryIconKey } from "./categoryIcons";
import { FLAT_ICONS } from "./flatIcons";
import { NOUN_ICONS } from "./nounIcons";

describe("iconForCategory", () => {
  it("falls back to the keyword-matched guess when no icon_key is given", () => {
    expect(iconForCategory("Groceries")).toEqual({ kind: "image-color", src: FLAT_ICONS["groceries-category"].src });
  });

  it("falls back to the keyword-matched guess when icon_key is null", () => {
    expect(iconForCategory("Utilities", null)).toEqual({ kind: "image-color", src: FLAT_ICONS["utilty-category"].src });
  });

  it("an explicit recognized icon_key overrides the keyword guess", () => {
    expect(iconForCategory("Pet Care", "groceries")).toEqual({ kind: "image-color", src: FLAT_ICONS["groceries-category"].src });
  });

  it("an unrecognized icon_key falls back to the keyword guess instead of erroring", () => {
    expect(iconForCategory("Groceries", "not-a-real-key")).toEqual({ kind: "image-color", src: FLAT_ICONS["groceries-category"].src });
  });

  it("a category with no keyword match falls back to the generic tag icon", () => {
    expect(iconForCategory("Something Unrecognized")).toEqual({ kind: "lucide", Icon: Tag });
  });

  it("null/undefined category falls back to the generic tag icon", () => {
    expect(iconForCategory(null)).toEqual({ kind: "lucide", Icon: Tag });
    expect(iconForCategory(undefined)).toEqual({ kind: "lucide", Icon: Tag });
  });

  it("the generic categories icon_key explicitly picks the tag fallback", () => {
    expect(iconForCategory("Pet Care", "categories")).toEqual({ kind: "lucide", Icon: Tag });
  });

  it("mortgage is matched before the broader housing/household rule", () => {
    expect(iconForCategory("Mortgage")).toEqual({ kind: "image-color", src: FLAT_ICONS["mortgage-category"].src });
    expect(iconForCategory("Household")).toEqual({ kind: "image-color", src: FLAT_ICONS["house-category"].src });
  });

  it("a category still backed by a monochrome Noun icon keeps using it", () => {
    expect(iconForCategory("Salary")).toEqual({ kind: "image", src: NOUN_ICONS.salary.src });
  });

  it("matches the newly bundled beauty and transfer icons", () => {
    expect(iconForCategory("Personal Care")).toEqual({ kind: "image-color", src: FLAT_ICONS["beauty-category"].src });
    expect(iconForCategory("Beauty")).toEqual({ kind: "image-color", src: FLAT_ICONS["beauty-category"].src });
    expect(iconForCategory("Transfer")).toEqual({ kind: "image-color", src: FLAT_ICONS["transfer-category"].src });
  });
});

describe("isCategoryIconKey", () => {
  it("recognizes the generic fallback key and every bundled category option", () => {
    for (const key of ["categories", "pet", "business", "mortgage", "housing", "rent", "groceries", "utilities", "beauty", "transfer"]) {
      expect(isCategoryIconKey(key)).toBe(true);
    }
  });

  it("rejects a category name that isn't a picker option", () => {
    expect(isCategoryIconKey("Pet Care")).toBe(false);
  });

  it("no longer offers the older monochrome icons as explicit picks", () => {
    for (const key of ["transport", "electric", "water", "internet", "phone", "streaming", "music", "car-insurance", "salary", "credit-card"]) {
      expect(isCategoryIconKey(key)).toBe(false);
    }
  });
});

describe("a category with a stored icon_key from before a monochrome icon was delisted", () => {
  it("still falls back to the same icon via the keyword guess, not the generic tag", () => {
    expect(iconForCategory("Electric Bill", "electric")).toEqual({ kind: "image", src: NOUN_ICONS.electric.src });
    expect(iconForCategory("Car Loan", "credit-card")).toEqual({ kind: "image", src: NOUN_ICONS["credit-card"].src });
  });
});
