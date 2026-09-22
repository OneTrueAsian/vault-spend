// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ensureUiStateMigrated, migrateLegacyProfileUiState } from "./profileUiState";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";

describe("migrateLegacyProfileUiState", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("does nothing when already migrated", async () => {
    localStorage.setItem("meadow-saved-ledger-filters", "[]");

    await migrateLegacyProfileUiState(1, true);

    expect(invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem("meadow-saved-ledger-filters")).toBe("[]");
  });

  it("writes every present legacy key to the database, marks migrated, then clears them", async () => {
    localStorage.setItem("meadow-saved-ledger-filters", "[{\"name\":\"Rent\"}]");
    localStorage.setItem("vaultspend-safe-to-spend-buffer", "250");
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      calls.push(String(cmd));
    });

    await migrateLegacyProfileUiState(1, false);

    expect(calls.filter((c) => c === "set_profile_ui_state")).toHaveLength(2);
    expect(calls).toContain("mark_ui_state_migrated");
    expect(calls.indexOf("mark_ui_state_migrated")).toBeGreaterThan(calls.lastIndexOf("set_profile_ui_state") - 1);
    expect(localStorage.getItem("meadow-saved-ledger-filters")).toBeNull();
    expect(localStorage.getItem("vaultspend-safe-to-spend-buffer")).toBeNull();
  });

  it("marks migrated even when no legacy key is present (fresh install)", async () => {
    await migrateLegacyProfileUiState(1, false);

    expect(invoke).toHaveBeenCalledWith("mark_ui_state_migrated");
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "set_profile_ui_state")).toHaveLength(0);
  });

  it("never removes a legacy key before the database write for it is confirmed", async () => {
    localStorage.setItem("meadow-budget-category-order", "[\"Rent\"]");
    let resolveWrite: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "set_profile_ui_state") {
        return new Promise((resolve) => {
          resolveWrite = () => resolve(undefined);
        });
      }
      return Promise.resolve(undefined);
    });

    const migration = migrateLegacyProfileUiState(1, false);
    await Promise.resolve(); // let the mocked invoke calls start
    expect(localStorage.getItem("meadow-budget-category-order")).toBe("[\"Rent\"]"); // still there mid-write

    resolveWrite?.();
    await migration;
    expect(localStorage.getItem("meadow-budget-category-order")).toBeNull();
  });
});

describe("ensureUiStateMigrated", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  it("fetches the generation and migration flag, runs the migration, and returns the generation", async () => {
    localStorage.setItem("vaultspend-safe-to-spend-buffer", "100");
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "get_current_generation") return 4;
      if (cmd === "is_ui_state_migrated") return false;
      return undefined;
    });

    const generation = await ensureUiStateMigrated();

    expect(generation).toBe(4);
    expect(invoke).toHaveBeenCalledWith("set_profile_ui_state", { key: "safe_to_spend_buffer", value: "100", expectedGeneration: 4 });
  });

  it("does not migrate again when already migrated", async () => {
    localStorage.setItem("vaultspend-safe-to-spend-buffer", "100");
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "get_current_generation") return 4;
      if (cmd === "is_ui_state_migrated") return true;
      return undefined;
    });

    await ensureUiStateMigrated();

    expect(invoke).not.toHaveBeenCalledWith("set_profile_ui_state", expect.anything());
  });
});
