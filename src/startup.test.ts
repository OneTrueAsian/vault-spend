// The argument names here are the contract with Rust (Tauri turns camelCase into snake_case); a typo
// would otherwise only show up in the real app.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  getStartupState,
  locateDataFile,
  openProfileAtLaunch,
  quitApp,
  restoreRegistryBackup,
  retryStartup,
  startWithNewDataFile,
  startWithNewProfileList,
  startupFailure,
  type StartupState,
} from "./startup";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ status: "open" });
});

describe("launch commands", () => {
  it("calls each command by its Rust name with the argument names Rust expects", async () => {
    await getStartupState();
    await retryStartup();
    await restoreRegistryBackup();
    await openProfileAtLaunch("second");
    await locateDataFile("E:\\data\\vaultspend.db");
    await quitApp();
    await startWithNewDataFile();
    await startWithNewProfileList();

    expect(invokeMock.mock.calls).toEqual([
      ["get_startup_state"],
      ["retry_startup"],
      ["restore_registry_backup"],
      ["open_profile_at_launch", { id: "second" }],
      ["locate_data_file", { path: "E:\\data\\vaultspend.db" }],
      ["quit_app"],
      ["start_with_new_data_file"],
      ["start_with_new_profile_list"],
    ]);
  });

  it("describes a failure to even ask as its own kind of launch error", () => {
    const error = startupFailure("the bridge is down");

    expect(error.kind).toBe("startup_failed");
    expect(error.details).toBe("the bridge is down");
    expect(error.can_restore_registry).toBe(false);
    expect(error.other_profiles).toEqual([]);
  });

  it("a selector state carries its profiles and last-used id", () => {
    const state: StartupState = {
      status: "selector",
      profiles: [{ id: "a", name: "Alex", icon_key: null, is_password_protected: true }],
      last_used_id: "a",
    };
    expect(state.status).toBe("selector");
  });

  it("a locked state carries the profile id and name", () => {
    const state: StartupState = { status: "locked", profile_id: "a", profile_name: "Alex" };
    expect(state.status).toBe("locked");
  });

  it("an empty_registry state carries nothing else", () => {
    const state: StartupState = { status: "empty_registry" };
    expect(state.status).toBe("empty_registry");
  });
});
