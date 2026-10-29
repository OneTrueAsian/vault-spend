import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SETTINGS } from "./quickSettings";
import { SETTINGS_GROUPS, SETTING_ENTRIES, isKnownSettingId, searchSettings } from "./settingsIndex";

describe("settings index", () => {
  it("lists the five groups in order with the spec's names", () => {
    expect(SETTINGS_GROUPS.map((g) => g.name)).toEqual(["Display", "Profiles & security", "Data", "Features", "About"]);
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(["display", "profiles", "data", "features", "about"]);
  });

  it("has unique ids, real groups and no blank text", () => {
    const ids = SETTING_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SETTING_ENTRIES) {
      expect(SETTINGS_GROUPS.some((g) => g.id === e.group)).toBe(true);
      for (const text of [e.label, e.description, e.keywords, e.card]) expect(text.trim()).not.toBe("");
    }
  });

  it("keeps the entries in page order: groups in list order", () => {
    const order = SETTING_ENTRIES.map((e) => SETTINGS_GROUPS.findIndex((g) => g.id === e.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("marks only the cards that are not always on screen as conditional", () => {
    expect(SETTING_ENTRIES.filter((e) => e.conditional).map((e) => e.id)).toEqual(["protection-leftovers"]);
  });

  it("knows its own ids, and the Quick settings defaults are among them", () => {
    expect(isKnownSettingId("backups")).toBe(true);
    expect(isKnownSettingId("nope")).toBe(false);
    for (const id of DEFAULT_QUICK_SETTINGS) expect(isKnownSettingId(id)).toBe(true);
  });
});

describe("searchSettings", () => {
  it("finds nothing for an empty or blank query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("matches without regard to case and ranks a name match first", () => {
    const hits = searchSettings("BACKUP");
    expect(hits[0].entry.id).toBe("backups");
    expect(hits[0].rank).toBe(0);
  });

  it("matches keywords, such as dark for Light or dark", () => {
    expect(searchSettings("dark").map((h) => h.entry.id)).toContain("theme");
  });

  it("matches the card title", () => {
    expect(searchSettings("feature toggles").map((h) => h.entry.id)).toContain("apply-to-debt");
  });

  it("treats the text literally: brackets, slashes and markup match nothing and never throw", () => {
    for (const q of ["(", "[", "<b>", "\\", ".*", "a|b"]) expect(() => searchSettings(q)).not.toThrow();
    for (const q of ["(", "[", "<b>", "\\"]) expect(searchSettings(q)).toEqual([]);
  });

  it("ranks a description-only match after a name match", () => {
    const hits = searchSettings("backup");
    const nameRanks = hits.filter((h) => h.rank === 0).length;
    expect(hits.slice(0, nameRanks).every((h) => h.rank === 0)).toBe(true);
    expect(hits.slice(nameRanks).every((h) => h.rank === 1)).toBe(true);
  });
});
