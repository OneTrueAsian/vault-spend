import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import fixtures from "../core/tests/fixtures/profile_ipc.json";
const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
import { invokeProfile } from "./profileIpc";
import { ProfileIpcError } from "./profileContracts";
import {
  beginRecovery,
  beginRegenerateRecovery,
  changePassword,
  commitRecovery,
  commitRegenerateRecovery,
  removeProtection,
  verifyCurrentPassword,
  verifyRecoveryCode,
} from "./protection";
import type { SetupChallenge } from "./protection";
import type { StartupState } from "./startup";

beforeEach(() => {
  native.mockReset();
});
describe("profile typed IPC", () => {
  it("keeps command argument names and return types for password/recovery lifecycle operations", async () => {
    native.mockImplementation((command) =>
      Promise.resolve(
        command.startsWith("begin_")
          ? fixtures.challenge
          : ["change_password", "commit_recovery", "commit_regenerate_recovery"].includes(command)
            ? fixtures.challenge.recovery_display
            : null,
      ),
    );
    const answers: [string, string] = ["0000", "0000"];
    await verifyCurrentPassword("secret", 4);
    await changePassword("secret", "token", answers);
    await beginRegenerateRecovery("secret", 4);
    await commitRegenerateRecovery("token", answers);
    await removeProtection("secret", 4);
    await verifyRecoveryCode("a", "code");
    await beginRecovery("a", "code", "new-secret", 4);
    await commitRecovery("a", "code", "token", answers);
    expect(native.mock.calls).toEqual([
      ["verify_current_password", { password: "secret", expectedGeneration: 4 }],
      ["change_password", { currentPassword: "secret", token: "token", answers }],
      ["begin_regenerate_recovery", { currentPassword: "secret", expectedGeneration: 4 }],
      ["commit_regenerate_recovery", { token: "token", answers }],
      ["remove_protection", { currentPassword: "secret", expectedGeneration: 4 }],
      ["verify_recovery_code", { id: "a", code: "code" }],
      ["begin_recovery", { id: "a", code: "code", newPassword: "new-secret", expectedGeneration: 4 }],
      ["commit_recovery", { id: "a", code: "code", token: "token", answers }],
    ]);
    expectTypeOf<ReturnType<typeof invokeProfile<"get_startup_state">>>().toEqualTypeOf<Promise<StartupState>>();
    expectTypeOf<ReturnType<typeof invokeProfile<"begin_protection_setup">>>().toEqualTypeOf<Promise<SetupChallenge>>();
  });

  it("refuses malformed replies from each family without retrying writes or including reply secrets", async () => {
    native.mockResolvedValue({ privateValue: "never-echo-a-secret" });
    const calls = [
      () => invokeProfile("get_startup_state"),
      () => invokeProfile("begin_protection_setup", { password: "never-echo-a-password", expectedGeneration: 4 }),
      () => invokeProfile("change_password", { currentPassword: "secret", token: "token", answers: ["0", "0"] }),
      () => invokeProfile("verify_recovery_code", { id: "a", code: "secret" }),
      () => invokeProfile("list_protection_leftovers", { expectedProfileId: "a", expectedGeneration: 4 }),
      () =>
        invokeProfile("delete_protection_leftovers", {
          pathsToDelete: ["a.db"],
          expectedProfileId: "a",
          expectedGeneration: 4,
        }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: "invalid_response" });
    }
    expect(native).toHaveBeenCalledTimes(calls.length);
    await expect(calls[1]()).rejects.not.toThrow(/never-echo/);
  });

  it("preserves structured refusal identity across wording and marks legacy strings without guessing", async () => {
    for (const message of ["The session changed.", "Open the profile again."]) {
      native.mockRejectedValueOnce({ code: "stale_profile", message });
      await expect(invokeProfile("get_startup_state")).rejects.toMatchObject({ code: "stale_profile", message });
    }
    native.mockRejectedValueOnce("That password didn't work.");
    await expect(verifyCurrentPassword("secret", 4)).rejects.toMatchObject({
      code: "legacy_error",
      message: "That password didn't work.",
    });
    native.mockRejectedValueOnce(new Error("bridge unavailable"));
    await expect(invokeProfile("get_startup_state")).rejects.toBeInstanceOf(ProfileIpcError);
    expect(native).toHaveBeenCalledTimes(4);
  });

  it("routes profile CRUD, UI-state and generation commands with exact arguments and typed returns", async () => {
    native.mockImplementation((command) =>
      Promise.resolve(
        command === "create_profile"
          ? "Created"
          : command === "get_current_generation"
            ? 7
            : command === "get_profile_ui_state"
              ? "{}"
              : command === "is_ui_state_migrated"
                ? true
                : null,
      ),
    );
    expect(await invokeProfile("create_profile", { name: "Home" })).toBe("Created");
    await invokeProfile("rename_profile", { id: "a", newName: "Away" });
    await invokeProfile("delete_profile", { id: "a" });
    expect(await invokeProfile("get_current_generation")).toBe(7);
    expect(await invokeProfile("get_profile_ui_state", { key: "saved_filters" })).toBe("{}");
    await invokeProfile("set_profile_ui_state", { key: "saved_filters", value: "[]", expectedGeneration: 7 });
    await invokeProfile("mark_ui_state_migrated");
    expect(await invokeProfile("is_ui_state_migrated")).toBe(true);
    expect(native.mock.calls).toEqual([
      ["create_profile", { name: "Home" }],
      ["rename_profile", { id: "a", newName: "Away" }],
      ["delete_profile", { id: "a" }],
      ["get_current_generation"],
      ["get_profile_ui_state", { key: "saved_filters" }],
      ["set_profile_ui_state", { key: "saved_filters", value: "[]", expectedGeneration: 7 }],
      ["mark_ui_state_migrated"],
      ["is_ui_state_migrated"],
    ]);
    expectTypeOf<ReturnType<typeof invokeProfile<"get_current_generation">>>().toEqualTypeOf<Promise<number>>();
    expectTypeOf<ReturnType<typeof invokeProfile<"get_profile_ui_state">>>().toEqualTypeOf<Promise<string | null>>();
    expectTypeOf<ReturnType<typeof invokeProfile<"is_ui_state_migrated">>>().toEqualTypeOf<Promise<boolean>>();
  });

  it("refuses malformed CRUD/UI-state replies without retrying and keeps legacy refusals distinct", async () => {
    native.mockResolvedValue({ unexpected: true });
    const calls = [
      () => invokeProfile("create_profile", { name: "Home" }),
      () => invokeProfile("rename_profile", { id: "a", newName: "Away" }),
      () => invokeProfile("delete_profile", { id: "a" }),
      () => invokeProfile("get_current_generation"),
      () => invokeProfile("get_profile_ui_state", { key: "saved_filters" }),
      () => invokeProfile("set_profile_ui_state", { key: "saved_filters", value: "x", expectedGeneration: 1 }),
      () => invokeProfile("mark_ui_state_migrated"),
      () => invokeProfile("is_ui_state_migrated"),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "invalid_response" });
    expect(native).toHaveBeenCalledTimes(calls.length);
    for (const bad of [-1, 1.5, "7", null]) {
      native.mockResolvedValueOnce(bad);
      await expect(invokeProfile("get_current_generation")).rejects.toMatchObject({ code: "invalid_response" });
    }
    native.mockResolvedValueOnce(5);
    await expect(invokeProfile("get_profile_ui_state", { key: "saved_filters" })).rejects.toMatchObject({
      code: "invalid_response",
    });
    native.mockResolvedValueOnce(null);
    await expect(invokeProfile("get_profile_ui_state", { key: "saved_filters" })).resolves.toBeNull();
    native.mockRejectedValueOnce("A profile named 'Home' already exists.");
    await expect(invokeProfile("create_profile", { name: "Home" })).rejects.toMatchObject({
      code: "legacy_error",
      message: "A profile named 'Home' already exists.",
    });
  });

  it("routes auto-lock commands and validates the settings reply", async () => {
    const settings = {
      inactivity_minutes: 15 as const,
      lock_when_hidden: true,
      lock_on_focus_loss: false,
      lock_on_system_event: true,
      system_event_supported: true,
    };
    native.mockImplementation((command) => Promise.resolve(command === "get_auto_lock_settings" ? settings : null));
    expect(await invokeProfile("get_auto_lock_settings")).toEqual(settings);
    const { system_event_supported: _supported, ...saved } = settings;
    await invokeProfile("set_auto_lock_settings", { settings: saved, expectedGeneration: 3 });
    await invokeProfile("record_trusted_activity", { expectedGeneration: 3 });
    expect(native.mock.calls).toEqual([
      ["get_auto_lock_settings"],
      ["set_auto_lock_settings", { settings: saved, expectedGeneration: 3 }],
      ["record_trusted_activity", { expectedGeneration: 3 }],
    ]);
    for (const bad of [
      null,
      { ...settings, inactivity_minutes: 7 },
      { ...settings, lock_when_hidden: "yes" },
      { ...settings, system_event_supported: undefined },
    ]) {
      native.mockResolvedValueOnce(bad);
      await expect(invokeProfile("get_auto_lock_settings")).rejects.toMatchObject({ code: "invalid_response" });
    }
    native.mockResolvedValueOnce({ unexpected: true });
    await expect(invokeProfile("record_trusted_activity", { expectedGeneration: 3 })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("keeps the profile refusal code when the message is reworded", async () => {
    for (const message of ["A profile named 'Home' already exists.", "Different wording entirely."]) {
      native.mockRejectedValueOnce({ code: "duplicate_profile_name", message });
      await expect(invokeProfile("rename_profile", { id: "a", newName: "Home" })).rejects.toMatchObject({
        code: "duplicate_profile_name",
        message,
      });
    }
  });
});
