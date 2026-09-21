import { describe, expect, it } from "vitest";
import { allocationRows, driftStatus, DRIFT_ALERT_POINTS, targetsTotal } from "./allocation";

const h = (asset_class: string | null, value: string) => ({ asset_class, value });
const t = (asset_class: string, percent: string) => ({ asset_class, percent });

describe("allocationRows", () => {
  it("sorts by value, names unclassified holdings 'Other', and shares out 100%", () => {
    const rows = allocationRows([h("Bonds", "1000"), h("US Stocks", "7000"), h(null, "2000"), h("US Stocks", "0")], []);

    expect(rows.map((r) => r.assetClass)).toEqual(["US Stocks", "Other", "Bonds"]);
    expect(rows.map((r) => r.currentPct)).toEqual([70, 20, 10]);
    expect(rows.every((r) => r.targetPct === null && r.driftPoints === null)).toBe(true);
  });

  it("measures drift as current minus target, in percentage points", () => {
    const rows = allocationRows([h("US Stocks", "7000"), h("Bonds", "3000")], [t("US Stocks", "60"), t("Bonds", "40")]);

    const stocks = rows.find((r) => r.assetClass === "US Stocks")!;
    const bonds = rows.find((r) => r.assetClass === "Bonds")!;
    expect(stocks).toMatchObject({ currentPct: 70, targetPct: 60, driftPoints: 10 });
    expect(bonds).toMatchObject({ currentPct: 30, targetPct: 40, driftPoints: -10 });
  });

  it("lists a class that has a target but no holdings, fully under", () => {
    const rows = allocationRows([h("US Stocks", "1000")], [t("US Stocks", "80"), t("Bonds", "20")]);

    expect(rows.find((r) => r.assetClass === "Bonds")).toMatchObject({ value: 0, currentPct: 0, targetPct: 20, driftPoints: -20 });
  });

  it("keeps a class with holdings but no target free of drift", () => {
    const rows = allocationRows([h("US Stocks", "500"), h("Gold", "500")], [t("US Stocks", "100")]);

    expect(rows.find((r) => r.assetClass === "Gold")).toMatchObject({ targetPct: null, driftPoints: null });
  });

  it("with no holdings shows only the targets, at zero", () => {
    const rows = allocationRows([], [t("Bonds", "40")]);

    expect(rows).toEqual([{ assetClass: "Bonds", value: 0, currentPct: 0, targetPct: 40, driftPoints: -40 }]);
  });
});

describe("driftStatus", () => {
  it("is quiet within the tolerance and names the direction beyond it", () => {
    expect(driftStatus(null)).toBe("none");
    expect(driftStatus(DRIFT_ALERT_POINTS - 0.1)).toBe("ok");
    expect(driftStatus(-(DRIFT_ALERT_POINTS - 0.1))).toBe("ok");
    expect(driftStatus(DRIFT_ALERT_POINTS)).toBe("over");
    expect(driftStatus(-DRIFT_ALERT_POINTS)).toBe("under");
  });
});

describe("targetsTotal", () => {
  it("adds up the targets", () => {
    expect(targetsTotal([t("US Stocks", "60"), t("Bonds", "30.5")])).toBe(90.5);
    expect(targetsTotal([])).toBe(0);
  });
});
