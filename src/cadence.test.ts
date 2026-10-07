import { describe, expect, it } from "vitest";
import { CADENCE_OPTIONS, cadenceLabel } from "./cadence";

describe("cadenceLabel", () => {
  it("names each cadence the way people say it", () => {
    expect(cadenceLabel("weekly")).toBe("Weekly");
    expect(cadenceLabel("biweekly")).toBe("Every 2 weeks");
    expect(cadenceLabel("monthly")).toBe("Monthly");
    expect(cadenceLabel("annual")).toBe("Yearly");
  });

  it("capitalises anything else rather than hiding it", () => {
    expect(cadenceLabel("quarterly")).toBe("Quarterly");
    expect(cadenceLabel("")).toBe("");
  });

  it("covers every cadence the menus offer", () => {
    for (const c of CADENCE_OPTIONS) expect(cadenceLabel(c)).toMatch(/^[A-Z]/);
  });
});
