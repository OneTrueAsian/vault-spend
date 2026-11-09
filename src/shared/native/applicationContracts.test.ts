import { describe, expect, it } from "vitest";
import { financialMutations, validateApplicationResult } from "./applicationContracts";
describe("legacy application read boundaries", () => {
  it("refuses numeric money, missing nulls and incomplete protection metadata", () => {
    expect(() =>
      validateApplicationResult("list_assets", [
        {
          id: 1,
          name: "Fixture",
          asset_type: "other",
          value: 12,
          valued_on: "2026-10-01",
          notes: null,
          member_id: null,
          member_name: null,
        },
      ]),
    ).toThrow();
    expect(() =>
      validateApplicationResult("list_profiles", [{ id: "fixture", name: "Fixture", is_active: true, icon_key: null }]),
    ).toThrow();
    expect(() => validateApplicationResult("recurring_totals", { monthly_expense: "0" })).toThrow();
  });
  it("accepts genuine empty lists and keeps exact asset money", () => {
    expect(validateApplicationResult("list_holdings", [])).toEqual([]);
    const rows = [
      {
        id: 1,
        name: "Fixture",
        asset_type: "other",
        value: "9007199254740992.01",
        valued_on: "2026-10-01",
        notes: null,
        member_id: null,
        member_name: null,
      },
    ];
    expect(validateApplicationResult("list_assets", rows)).toBe(rows);
  });
  it("invalidates financial settings/budget/asset mutations but not backup bookkeeping", () => {
    for (const command of ["set_budget", "update_asset_value", "refresh_live_prices", "create_recurring"])
      expect(financialMutations.has(command)).toBe(true);
    for (const command of ["create_backup_now", "set_profile_icon", "get_app_settings"])
      expect(financialMutations.has(command)).toBe(false);
  });
});
