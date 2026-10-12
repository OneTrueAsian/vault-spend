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
});
