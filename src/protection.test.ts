// Argument names here are the contract with Rust (Tauri turns camelCase into snake_case); a typo
// would otherwise only show up in the real app.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  beginProtectionSetup,
  cancelProtectionSetup,
  commitProtectionSetup,
  deleteProtectionLeftovers,
  listProtectionLeftovers,
  lockCurrentProfile,
  selectProfile,
  showProfileSelector,
  unlockProfile,
} from "./protection";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ status: "open" });
});

describe("protection.ts invoke wrappers", () => {
  it("calls each command by its Rust name with the argument names Rust expects", async () => {
    await showProfileSelector();
    await selectProfile("alpha");
    await unlockProfile("alpha", "hunter2hunter2");
    await lockCurrentProfile(5);
    await beginProtectionSetup("hunter2hunter2", 5);
    await cancelProtectionSetup("tok-1");
    await commitProtectionSetup("tok-1", ["AAAA", "BBBB"], "alpha", null);
    await listProtectionLeftovers("alpha", 5);
    await deleteProtectionLeftovers(["a.db", "b.db"], "alpha", 5);

    expect(invokeMock.mock.calls).toEqual([
      ["show_profile_selector"],
      ["select_profile", { id: "alpha" }],
      ["unlock_profile", { id: "alpha", password: "hunter2hunter2" }],
      ["lock_current_profile", { expectedGeneration: 5 }],
      ["begin_protection_setup", { password: "hunter2hunter2", expectedGeneration: 5 }],
      ["cancel_protection_setup", { token: "tok-1" }],
      [
        "commit_protection_setup",
        { token: "tok-1", answers: ["AAAA", "BBBB"], targetProfileId: "alpha", newProfileName: null },
      ],
      ["list_protection_leftovers", { expectedProfileId: "alpha", expectedGeneration: 5 }],
      ["delete_protection_leftovers", { pathsToDelete: ["a.db", "b.db"], expectedProfileId: "alpha", expectedGeneration: 5 }],
    ]);
  });
});
