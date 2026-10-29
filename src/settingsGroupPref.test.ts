// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSettingsGroup, writeSettingsGroup } from "./settingsGroupPref";

describe("settings group preference", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("opens on Quick settings when nothing was saved", () => {
    expect(readSettingsGroup()).toBe("quick");
  });

  it("remembers the last tab", () => {
    writeSettingsGroup("data");
    expect(localStorage.getItem("vaultspend-settings-group")).toBe("data");
    expect(readSettingsGroup()).toBe("data");
  });

  it("falls back to Quick settings for an id it does not know", () => {
    localStorage.setItem("vaultspend-settings-group", "reminders");
    expect(readSettingsGroup()).toBe("quick");
  });

  it("falls back to Quick settings when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSettingsGroup()).toBe("quick");
  });

  it("does not throw when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeSettingsGroup("about")).not.toThrow();
  });
});
