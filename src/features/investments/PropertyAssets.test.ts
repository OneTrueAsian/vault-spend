import { describe, expect, it } from "vitest";
import { assetTypeLabel } from "./PropertyAssets";

describe("assetTypeLabel", () => {
  it("names the three choices the way the form does", () => {
    expect(assetTypeLabel("real_estate")).toBe("Real Estate");
    expect(assetTypeLabel("vehicle")).toBe("Vehicle");
    expect(assetTypeLabel("other")).toBe("Other");
  });

  it("names a type the form doesn't offer the same way an account type is named", () => {
    expect(assetTypeLabel("property")).toBe("Property");
    expect(assetTypeLabel("fine_art")).toBe("Fine Art");
  });
});
